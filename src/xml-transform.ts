// The code from which this is derived was developed while under contract from
// Broadbean Technology, and that code is Copyright 2021 Broadbean Technology.
// Subsequent changes are Copyright 2021 Peter Sergeant

import { createReadStream, ReadStream, PathLike } from "fs";
import { open as fOpen, FileHandle } from "fs/promises";
import { createStream } from "sax";
import { parseStringPromise, Builder } from "xml2js";

/**
 * Asynchronously transform specific records in large XML files
 *
 * Scans a large XML file for records, and then ad-hoc retrives them, passes
 * them off to an asychronous transformer, and rewrites them in the correct
 * order. The slightly strangely shaped API of `transformXML` is specifically
 * intended for use with some kind of promise throttler.
 *
 * Synopsis:
 *
 *     const generator = await transformXML(
 *         // Transformation function: <X>(x: any) => Promise<X>
 *         (x) => { return callWebService(x) },
 *         // Tag name of interest
 *         'bar',
 *         files.inputFilename, files.outputFilename
 *     );
 *
 */

export async function transformXML<X>(
  transformF: Transform<X>,
  tag: string,
  inputFilename: PathLike,
  outputFilename: PathLike
): Promise<Generator<Promise<void>>> {
  const io = await XMLTransform.setupIO(inputFilename, outputFilename);
  const scan = await XMLTransform.scan(io.inputStream, tag);
  return XMLTransform.transformGenerator(transformF, io, scan);
}

export type Transform<X> = (x: any) => Promise<X>;

type IO = {
  inputFilename: PathLike;
  outputFilename: PathLike;
  inputStream: ReadStream; // Only use a stream for the initial scan
  inputFileHandle: FileHandle;
  outputFileHandle: FileHandle;
};

type Offsets = [number, number][];

type Scan = {
  offsets: Offsets;
  endPosition: number;
};

export class XMLTransform {
  static async setupIO(
    inputFilename: PathLike,
    outputFilename: PathLike
  ): Promise<IO> {
    // For the initial sax-reader scan
    const inputStream = createReadStream(
      inputFilename,
      // Make sure the position counts are right
      { encoding: "ascii" }
    );
    // To read ad-hoc records from the file
    const inputFileHandle = await fOpen(inputFilename, "r");
    // To write ad-hoc records to the output
    const outputFileHandle = await fOpen(outputFilename, "w");

    return {
      inputFilename,
      outputFilename,
      inputStream,
      inputFileHandle,
      outputFileHandle,
    };
  }

  static closeIO(io: IO): Promise<any> {
    io.inputStream.destroy();
    const x = io.inputFileHandle.close();
    const y = io.outputFileHandle.close();
    return Promise.all([x, y]);
  }

  static scan(stream: ReadStream, tag: string): Promise<Scan> {
    // Start and end of <tag>
    const offsets: Offsets = [];
    // Offsets of the current <tag>
    let current: [number?, number?] = [];

    return new Promise((resolve, reject) => {
      const saxStream = createStream(false, { lowercase: true });
      const p = (n: string): number =>
        // @ts-ignore: People who wrote typedefs decided to mark as private
        // but it's a must-have for us. Module has had a very stable API for
        // a long time, tests will catch it if that changes, and we can
        // petition the author to make this explicitly public.
        saxStream._parser[n]; // eslint-disable-line
      saxStream.on("opentag", (node) => {
        if (node.name === tag) {
          current[0] = p("startTagPosition") - 1;
        }
      });
      saxStream.on("closetag", (name) => {
        if (name === tag) {
          current[1] = p("position");
          offsets.push(current as [number, number]);
          current = [];
        }
      });
      saxStream.on("end", () =>
        resolve({ offsets, endPosition: p("position") })
      );
      saxStream.on("error", (e) => {
        reject(new Error(`Failed to scan input XML: ${e.message}`));
      });
      stream.pipe(saxStream);
    });
  }

  static async readBuffer(fh: FileHandle, from: number, to: number) {
    const buffer = Buffer.alloc(to - from);
    await fh.read(buffer, 0, to - from, from);
    return buffer;
  }

  // Note that the return value of the generator is Promise<void> -- the
  // return value of each promise is simply meant to be discarded by the
  // Promise Pool that runs it.
  static *transformGenerator<X>(
    f: Transform<X>,
    io: IO,
    scan: Scan
  ): Generator<Promise<void>> {
    const fhIn: FileHandle = io.inputFileHandle;
    const fhOut: FileHandle = io.outputFileHandle;

    // This is used to ensure we write in the correct sequence -- we make sure
    // that we queue the writes on to this in the order we want them written,
    // and they get written that way regardless of what order the data becomes
    // available to write.
    let writeHead: any = Promise.resolve();
    let position = 0;

    for (const [startOffset, endOffset] of scan.offsets) {
      const localPosition = position;
      // Read in the difference between the write-head and the offset of
      // this record
      writeHead = writeHead
        .then(
          (): Promise<Buffer> =>
            XMLTransform.readBuffer(fhIn, localPosition, startOffset)
        )
        .then((filler: any) => fhOut.write(filler));
      position = endOffset;

      // The record. This is ultimately what we'll yield, but before we do so
      // we need to add it to the writeHead Promise chain
      const record = XMLTransform.readBuffer(fhIn, startOffset, endOffset)
        .then((x) => parseStringPromise(x))
        .then(f);

      // When the record returns, we'll write it. The writeHead awaits that.
      writeHead = writeHead.then(async () => {
        const builder = new Builder({
          headless: true,
          cdata: true,
          renderOpts: { pretty: true },
        });
        const r = await record;
        const xml = builder.buildObject(r);
        return fhOut.write(xml);
      });

      yield record.then(() => undefined);
    }

    writeHead = writeHead
      .then(() =>
        XMLTransform.readBuffer(
          fhIn,
          scan.offsets[scan.offsets.length - 1][1],
          scan.endPosition
        )
      )
      .then((filler: any) => fhOut.write(filler));
    yield writeHead.then(() => undefined);
  }
}
