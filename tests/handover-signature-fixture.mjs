// Pure source fixture: local test data only.
import {Buffer} from 'node:buffer'
import { crc32, deflateSync } from "node:zlib";
export function signatureFixture(ink = true) {
    const chunk = (type, data)=>{
        const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
        size.writeUInt32BE(data.length);
        crc.writeUInt32BE(crc32(Buffer.concat([
            name,
            data
        ])));
        return Buffer.concat([
            size,
            name,
            data,
            crc
        ]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(16, 0);
    header.writeUInt32BE(8, 4);
    header[8] = 8;
    header[9] = 6;
    const raw = Buffer.alloc((16 * 4 + 1) * 8);
    if (ink) for(let y = 1; y < 7; y++)raw[y * 65 + 1 + y * 4 + 3] = 255;
    return `data:image/png;base64,${Buffer.concat([
        Buffer.from([
            137,
            80,
            78,
            71,
            13,
            10,
            26,
            10
        ]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0))
    ]).toString("base64")}`;
}
