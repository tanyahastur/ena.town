export enum Opcode {
    JOINED = 1,
    LEAVE = 2,
    SAY = 3,
    MOVE = 4,
    PING = 5,
    PONG = 6,
    UPDATE = 7,
    ERROR = 8,
}

export type BinaryType =
    | 'u8' | 'u16' | 'u32' | 'u64'
    | 'i8' | 'i16' | 'i32' | 'i64'
    | 'f32' | 'f64'
    | 'string'
    | Struct
    | Tuple
    | ArrayType;

export interface ArrayType {
    type: 'array';
    element: BinaryType;
    length: number;
}

export interface StructField {
    name: string;
    type: BinaryType;
}

export class Struct {
    fields: StructField[];

    constructor(fields: StructField[]) {
        this.fields = fields;
    }

    measure(): number {
        return this.fields.reduce((sum, f) => sum + measure(f.type), 0);
    }

    write(writer: BinaryWriter, data: Record<string, any>) {
        for (const f of this.fields) {
            write(writer, f.type, data[f.name]);
        }
    }

    read(reader: BinaryReader): Record<string, any> {
        const obj: Record<string, any> = {};
        for (const f of this.fields) {
            obj[f.name] = read(reader, f.type);
        }
        return obj;
    }
}

export class Tuple {
    elements: BinaryType[];

    constructor(elements: BinaryType[]) {
        this.elements = elements;
    }

    measure(): number {
        return this.elements.reduce((sum, t) => sum + measure(t), 0);
    }

    write(writer: BinaryWriter, data: any[]) {
        this.elements.forEach((t, i) => write(writer, t, data[i]));
    }

    read(reader: BinaryReader, initialOffset: number = 0): any[] {
        reader.offset = initialOffset;
        return this.elements.map(t => read(reader, t));
    }
}


// Reader / Writer

export class BinaryWriter {
    view: DataView;
    offset = 0;

    constructor(public buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }

    writeU8(val: number) { this.view.setUint8(this.offset, val); this.offset += 1; }
    writeU16(val: number) { this.view.setUint16(this.offset, val, false); this.offset += 2; }
    writeU32(val: number) { this.view.setUint32(this.offset, val, false); this.offset += 4; }
    writeU64(val: bigint) { this.view.setBigUint64(this.offset, val, false); this.offset += 8; }

    writeI8(val: number) { this.view.setInt8(this.offset, val); this.offset += 1; }
    writeI16(val: number) { this.view.setInt16(this.offset, val, false); this.offset += 2; }
    writeI32(val: number) { this.view.setInt32(this.offset, val, false); this.offset += 4; }
    writeI64(val: bigint) { this.view.setBigInt64(this.offset, val, false); this.offset += 8; }

    writeF32(val: number) { this.view.setFloat32(this.offset, val, false); this.offset += 4; }
    writeF64(val: number) { this.view.setFloat64(this.offset, val, false); this.offset += 8; }

    writeString(val: string) {
        const bytes = encoder.encode(val);
        this.writeU16(bytes.length);
        new Uint8Array(this.view.buffer, this.offset, bytes.length).set(bytes);
        this.offset += bytes.length;
        return;
    }
}

export class BinaryReader {
    view: DataView;
    offset = 0;

    constructor(public buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }

    readU8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
    readU16() { const v = this.view.getUint16(this.offset, false); this.offset += 2; return v; }
    readU32() { const v = this.view.getUint32(this.offset, false); this.offset += 4; return v; }
    readU64(): bigint { const v = this.view.getBigUint64(this.offset, false); this.offset += 8; return v; }

    readI8() { const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
    readI16() { const v = this.view.getInt16(this.offset, false); this.offset += 2; return v; }
    readI32() { const v = this.view.getInt32(this.offset, false); this.offset += 4; return v; }
    readI64(): bigint { const v = this.view.getBigInt64(this.offset, false); this.offset += 8; return v; }

    readF32() { const v = this.view.getFloat32(this.offset, false); this.offset += 4; return v; }
    readF64() { const v = this.view.getFloat64(this.offset, false); this.offset += 8; return v; }

    readString() {
        const [str, newOffset] = decodeString(this.view, this.offset);
        this.offset = newOffset;
        return str;
    }
}

// Helpers

export function measure(type: BinaryType): number {
    if (typeof type === 'string') {
        switch(type) {
            case 'u8': case 'i8': return 1;
            case 'u16': case 'i16': return 2;
            case 'u32': case 'i32': case 'f32': return 4;
            case 'f64': return 8;
        }
    } else if (type instanceof Struct || type instanceof Tuple) {
        return type.measure();
    } else if ('type' in type && type.type === 'array') {
        return measure(type.element) * type.length;
    }
    throw new Error('Unknown type for measure');
}

export function write(writer: BinaryWriter, type: BinaryType, value: any) {
    if (typeof type === 'string') {
        switch(type) {
            case 'u8': return writer.writeU8(value);
            case 'u16': return writer.writeU16(value);
            case 'u32': return writer.writeU32(value);
            case 'u64': return writer.writeU64(value);
            case 'i8': return writer.writeI8(value);
            case 'i16': return writer.writeI16(value);
            case 'i32': return writer.writeI32(value);
            case 'i64': return writer.writeI64(value);
            case 'f32': return writer.writeF32(value);
            case 'f64': return writer.writeF64(value);
            case 'string': return writer.writeString(value);
        }
    } else if (type instanceof Struct) {
        return type.write(writer, value);
    } else if (type instanceof Tuple) {
        return type.write(writer, value);
    } else if ('type' in type && type.type === 'array') {
        for (let i = 0; i < type.length; i++) {
            write(writer, type.element, value[i]);
        }
    } else {
        throw new Error('Unknown type for write');
    }
}

export function read(reader: BinaryReader, type: BinaryType): any {
    if (typeof type === 'string') {
        switch(type) {
            case 'u8': return reader.readU8();
            case 'u16': return reader.readU16();
            case 'u32': return reader.readU32();
            case 'u64': return reader.readU64();
            case 'i8': return reader.readI8();
            case 'i16': return reader.readI16();
            case 'i32': return reader.readI32();
            case 'i64': return reader.readI64();
            case 'f32': return reader.readF32();
            case 'f64': return reader.readF64();
            case 'string': return reader.readString();
        }
    } else if (type instanceof Struct) {
        return type.read(reader);
    } else if (type instanceof Tuple) {
        return type.read(reader);
    } else if ('type' in type && type.type === 'array') {
        return Array.from({ length: type.length }, (_) => read(reader, type.element)); // (_, i) => read(reader, type.element));
    } else {
        throw new Error('Unknown type for read');
    }
}

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export function decodeString(view: DataView, offset: number): [string, number] {
    if (offset + 2 > view.byteLength) throw new Error('Offset fuera de rango');
    const len = view.getUint16(offset);
    offset += 2;
    if (offset + len > view.byteLength) throw new Error('String excede buffer');
    const bytes = new Uint8Array(view.buffer, offset, len);
    const str = decoder.decode(bytes);
    return [str, offset + len];
}

export function calcEntitySize(entity: any): number {
    const idBytes = encoder.encode(entity.id);
    const usernameBytes = encoder.encode(entity.username);

    // Cada string = 2 bytes de longitud + contenido
    const idSize = 2 + idBytes.length;
    const usernameSize = 2 + usernameBytes.length;

    const moveSize = 8;  // u64
    const connectedAtSize = 8; // u64

    return idSize + usernameSize + moveSize + connectedAtSize;
}

export function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
