"""Binary, self-resynchronizing USB serial protocol shared with the V0 firmware."""

from __future__ import annotations

import binascii
import dataclasses
import struct
from collections.abc import Iterable


MAGIC = b"NF"
VERSION = 1
TYPE_PING = 0x01
TYPE_FRAME = 0x10
TYPE_STATUS = 0x81
HEADER = struct.Struct("<2sBBHH")
CRC = struct.Struct("<H")
MAX_PAYLOAD = 2048


def crc16(data: bytes) -> int:
    """CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF)."""
    return binascii.crc_hqx(data, 0xFFFF)


@dataclasses.dataclass(frozen=True)
class Packet:
    message_type: int
    sequence: int
    payload: bytes


def encode_packet(message_type: int, sequence: int, payload: bytes = b"") -> bytes:
    if len(payload) > MAX_PAYLOAD:
        raise ValueError(f"payload too large: {len(payload)}")
    header = HEADER.pack(MAGIC, VERSION, message_type, len(payload), sequence & 0xFFFF)
    checksum = crc16(header[2:] + payload)
    return header + payload + CRC.pack(checksum)


def encode_logical_frame(
    sequence: int,
    colors: Iterable[Iterable[tuple[int, int, int]]],
    global_brightness: int = 4,
) -> bytes:
    rows = [list(row) for row in colors]
    if not rows or not rows[0]:
        raise ValueError("frame must have at least one row and note")
    note_count = len(rows[0])
    if any(len(row) != note_count for row in rows):
        raise ValueError("all logical rows must have the same note count")
    if not 0 <= global_brightness <= 31:
        raise ValueError("APA102 global brightness must be in 0..31")
    payload = bytearray((global_brightness, len(rows), note_count, 0))
    for row in rows:
        for color in row:
            if len(color) != 3 or any(not 0 <= component <= 255 for component in color):
                raise ValueError(f"invalid RGB color {color!r}")
            payload.extend(color)
    return encode_packet(TYPE_FRAME, sequence, bytes(payload))


class StreamDecoder:
    """Incrementally recover valid packets and skip noise/corrupt frames."""

    def __init__(self) -> None:
        self._buffer = bytearray()
        self.crc_errors = 0
        self.header_errors = 0

    def feed(self, data: bytes) -> list[Packet]:
        self._buffer.extend(data)
        packets: list[Packet] = []
        while True:
            magic_at = self._buffer.find(MAGIC)
            if magic_at < 0:
                # Retain a terminal N because it may be the first magic byte.
                self._buffer[:] = self._buffer[-1:] if self._buffer.endswith(MAGIC[:1]) else b""
                break
            if magic_at:
                del self._buffer[:magic_at]
            if len(self._buffer) < HEADER.size:
                break
            magic, version, message_type, length, sequence = HEADER.unpack_from(self._buffer)
            if magic != MAGIC or version != VERSION or length > MAX_PAYLOAD:
                self.header_errors += 1
                del self._buffer[0]
                continue
            packet_size = HEADER.size + length + CRC.size
            if len(self._buffer) < packet_size:
                break
            raw = bytes(self._buffer[:packet_size])
            expected_crc = CRC.unpack_from(raw, packet_size - CRC.size)[0]
            actual_crc = crc16(raw[2:-CRC.size])
            if actual_crc != expected_crc:
                self.crc_errors += 1
                del self._buffer[0]
                continue
            payload = raw[HEADER.size:-CRC.size]
            packets.append(Packet(message_type, sequence, payload))
            del self._buffer[:packet_size]
        return packets

