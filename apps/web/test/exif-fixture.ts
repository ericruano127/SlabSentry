/** Little-endian TIFF/EXIF with Make, Model, Software, Orientation, ExifIFD(DateTimeOriginal, BodySerial), GPS IFD. */
export function exifTiff(orientation = 6) {
  const entries: [number, number, number, Buffer | number][] = []; // tag, type, count, value
  const strings: Buffer[] = [];
  const t = Buffer.alloc(1024);
  t.write("II", 0, "latin1");
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(8, 4);
  let heap = 400;
  const putStr = (s: string) => { const off = heap; t.write(s + "\0", heap, "latin1"); heap += s.length + 1; return off; };
  const writeIfd = (at: number, list: [number, number, number, number][]) => {
    t.writeUInt16LE(list.length, at);
    list.forEach(([tag, type, count, value], i) => {
      const e = at + 2 + i * 12;
      t.writeUInt16LE(tag, e); t.writeUInt16LE(type, e + 2); t.writeUInt32LE(count, e + 4);
      if (type === 3 && count === 1) t.writeUInt16LE(value, e + 8); else t.writeUInt32LE(value, e + 8);
    });
    t.writeUInt32LE(0, at + 2 + list.length * 12);
  };
  void entries; void strings;
  const make = putStr("Canon"), model = putStr("EOS R5"), sw = putStr("Adobe Photoshop 25.0"), dto = putStr("2026:01:01 10:00:00"), serial = putStr("SN-0042424242");
  writeIfd(8, [[0x010f, 2, 6, make], [0x0110, 2, 7, model], [0x0112, 3, 1, orientation], [0x0131, 2, 21, sw], [0x8769, 4, 1, 200], [0x8825, 4, 1, 300]]);
  writeIfd(200, [[0x9003, 2, 20, dto], [0xa431, 2, 14, serial]]);
  writeIfd(300, [[0x0001, 2, 2, putStr("N")], [0x0002, 5, 3, putStr("40/1 44/1 0/1")]]);
  return t.subarray(0, heap);
}
export function app(marker: number, payload: Buffer) {
  const h = Buffer.from([0xff, marker, 0, 0]);
  h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
}
/** Wrap a clean JPEG with EXIF (GPS, serial, editor), XMP, IPTC, a comment and trailing hidden data. */
export function withMetadata(base: Buffer, orientation = 6) {
  const exif = app(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exifTiff(orientation)]));
  const xmp = app(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description xmp:CreatorTool="Adobe Photoshop 25.0" exif:GPSLatitude="40,44N"/></x:xmpmeta>', "latin1"));
  const iptc = app(0xed, Buffer.from("Photoshop 3.0\0By-line: Jane Collector", "latin1"));
  const com = app(0xfe, Buffer.from("owner: jane@example.com", "latin1"));
  const trailing = Buffer.from("PK\x03\x04 hidden zip payload", "latin1");
  return Buffer.concat([base.subarray(0, 2), exif, xmp, iptc, com, base.subarray(2), trailing]);
}

