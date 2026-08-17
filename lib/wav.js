import fs from "node:fs";

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const UINT32_MAX = 0xffffffff;

function readExactly(fd, buffer, position) {
  return fs.readSync(fd, buffer, 0, buffer.length, position) === buffer.length;
}

export function repairUnfinalizedWavHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r+");
  } catch {
    return false;
  }

  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < RIFF_HEADER_BYTES || fileSize - 8 > UINT32_MAX) return false;

    const riffHeader = Buffer.alloc(RIFF_HEADER_BYTES);
    if (!readExactly(fd, riffHeader, 0)) return false;
    if (riffHeader.toString("ascii", 0, 4) !== "RIFF" || riffHeader.toString("ascii", 8, 12) !== "WAVE") return false;

    const declaredRiffSize = riffHeader.readUInt32LE(4);
    let chunkOffset = RIFF_HEADER_BYTES;

    while (chunkOffset + CHUNK_HEADER_BYTES <= fileSize) {
      const chunkHeader = Buffer.alloc(CHUNK_HEADER_BYTES);
      if (!readExactly(fd, chunkHeader, chunkOffset)) return false;

      const chunkId = chunkHeader.toString("ascii", 0, 4);
      const declaredChunkSize = chunkHeader.readUInt32LE(4);
      const chunkDataOffset = chunkOffset + CHUNK_HEADER_BYTES;

      if (chunkId === "data") {
        const availableDataSize = fileSize - chunkDataOffset;
        const repairRiffSize = declaredRiffSize > fileSize - 8;
        const repairDataSize = declaredChunkSize > availableDataSize;
        if (!repairRiffSize && !repairDataSize) return false;

        const size = Buffer.alloc(4);
        if (repairDataSize) {
          size.writeUInt32LE(availableDataSize);
          fs.writeSync(fd, size, 0, size.length, chunkOffset + 4);
        }
        if (repairRiffSize) {
          size.writeUInt32LE(fileSize - 8);
          fs.writeSync(fd, size, 0, size.length, 4);
        }
        return true;
      }

      const paddedChunkSize = declaredChunkSize + (declaredChunkSize % 2);
      const nextChunkOffset = chunkDataOffset + paddedChunkSize;
      if (nextChunkOffset > fileSize) return false;
      chunkOffset = nextChunkOffset;
    }

    return false;
  } catch {
    return false;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}
