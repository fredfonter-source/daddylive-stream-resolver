export function unwrapWebpMpegTs(buf: Buffer): Buffer | null {
  if (buf.byteLength < 20) return null;
  if (buf.subarray(0, 4).toString("ascii") !== "RIFF") return null;
  if (buf.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  let pos = 12;
  while (pos + 8 <= buf.byteLength) {
    const fourcc = buf.subarray(pos, pos + 4).toString("ascii");
    const size = buf.readUInt32LE(pos + 4);
    const dataStart = pos + 8;
    const dataEnd = Math.min(dataStart + size, buf.byteLength);
    if (fourcc === "EXIF") {
      const payload = buf.subarray(dataStart, dataEnd);
      return payload.byteLength > 188 && payload[0] === 0x47 ? payload : null;
    }
    pos = dataEnd + (size & 1);
  }
  return null;
}
