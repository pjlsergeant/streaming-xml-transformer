// The code from which this is derived was developed while under contract from
// Broadbean Technology, and that code is Copyright 2021 Broadbean Technology.
// Subsequent changes are Copyright 2021 Peter Sergeant

const fsp = require("fs/promises");
const tap = require("tap");
const temp = require("temp").track();
const { transformXML, XMLTransform } = require("../dist/xml-transform");

const doc = `<?xml foo="bar"?>
<foo>
    <bar>๑</bar>
    sดme junk
    <bar attr="sma">foolalalfar</bar>
    <bar><![CDATA[2&>1]]></bar>
    more junk
</foo><!-- this is ok -->`;

function exhaustGenerator(generator, files) {
  const promises = [];
  for (const item of generator) promises.push(item);
  return Promise.all(promises).then(() => XMLTransform.closeIO(files));
}

async function tempFiles(content) {
  const inputFilename = temp.path({ suffix: ".xml" });
  const outputFilename = temp.path({ suffix: ".xml" });

  // The data we're going to want to read
  const readFileHandle = await fsp.open(inputFilename, "w");
  await readFileHandle.write(content);
  await readFileHandle.close();

  const files = await XMLTransform.setupIO(inputFilename, outputFilename);

  // Callback to get whatever was written
  const getWritten = async () => {
    const writeFileHandle = await fsp.open(outputFilename, "r");
    const data = await writeFileHandle.readFile();
    await writeFileHandle.close();
    return String(data);
  };

  return { ...files, getWritten };
}

tap.test("readBuffer utf8", async (t) => {
  const files = await tempFiles(doc);
  const thai = await XMLTransform.readBuffer(files.inputFileHandle, 28, 42);
  await XMLTransform.closeIO(files);
  t.equal(String(thai), "<bar>๑</bar>", "utf8 extracted");
  t.end();
});

tap.test("scan", async (t) => {
  const files = await tempFiles(doc);
  const data = await XMLTransform.scan(files.inputStream, "bar");
  t.equal(data.endPosition, 168, "endPosition matches");
  const asStrings = await Promise.all(
    data.offsets.map((offset) =>
      XMLTransform.readBuffer(files.inputFileHandle, ...offset).then((x) =>
        String(x)
      )
    )
  );
  await XMLTransform.closeIO(files);

  t.same(
    asStrings,
    [
      "<bar>๑</bar>",
      '<bar attr="sma">foolalalfar</bar>',
      "<bar><![CDATA[2&>1]]></bar>",
    ],
    "offsets scanned"
  );
  t.end();
});

tap.test("transformGenerator - identity", async (t) => {
  const transform = (j) => Promise.resolve(j);
  const files = await tempFiles(doc);
  const scan = await XMLTransform.scan(files.inputStream, "bar");

  const generator = XMLTransform.transformGenerator(transform, files, scan);

  await exhaustGenerator(generator, files);

  t.equal(await files.getWritten(), doc, "round-tripped");
  t.end();
});

tap.test("transformGenerator - write order", async (t) => {
  const delays = [100, 50, 75];
  const processed = [];
  const returned = [];

  const transform = (job) =>
    new Promise((resolve) => {
      const newJob = job;
      const delay = delays.shift();
      // Record when we were processed
      processed.push(delay);
      // Modify the node
      if (typeof newJob.bar === "object") {
        newJob.bar._ += "woo";
      } else {
        newJob.bar += "woo";
      }
      setTimeout(() => {
        returned.push(delay);
        resolve(newJob);
      }, delay);
    });

  const expected = doc.replace(/((]]>)?<\/bar>)/g, "woo$1");

  const files = await tempFiles(doc);
  const scan = await XMLTransform.scan(files.inputStream, "bar");

  const generator = XMLTransform.transformGenerator(transform, files, scan);

  await exhaustGenerator(generator, files);

  t.equal(await files.getWritten(), expected, "output xml matches");
  t.same(returned, [50, 75, 100], "returned in expected order");
  t.same(processed, [100, 50, 75], "processed in expected order");
  t.end();
});

tap.test("transform", async (t) => {
  const files = await tempFiles(doc);
  const generator = await transformXML(
    (x) => Promise.resolve(x),
    "bar",
    files.inputFilename,
    files.outputFilename
  );
  await exhaustGenerator(generator, files);
  t.equal(await files.getWritten(), doc, "output xml matches");
  t.end();
});

const badParse = ">new <now know how";
tap.test("bad xml scan", async (t) => {
  const files = await tempFiles(badParse);
  const expected = new Error(
    "Failed to scan input XML: Unexpected end\nLine: 0\nColumn: 18\nChar: "
  );
  await t.rejects(
    XMLTransform.scan(files.inputStream, "bar"),
    expected,
    "Bad parse rejected"
  );
  t.end();
});
