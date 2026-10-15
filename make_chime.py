"""Generate the local fixed reminder sound; no cloud TTS or key is used."""

import math
import struct
import wave
from pathlib import Path


RATE = 22050
SEGMENTS = [(660, 0.45), (880, 0.45), (990, 0.55)]


def samples():
    for frequency, duration in SEGMENTS:
        count = int(RATE * duration)
        for index in range(count):
            phase = index / RATE
            envelope = min(1.0, index / (RATE * 0.025), (count - index) / (RATE * 0.07))
            amplitude = int(9000 * max(0.0, envelope) * math.sin(2 * math.pi * frequency * phase))
            yield struct.pack("<h", amplitude)
        for _ in range(int(RATE * 0.07)):
            yield struct.pack("<h", 0)


target = Path(__file__).with_name("fixed-reminder.wav")
with wave.open(str(target), "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes(b"".join(samples()))
print(target)
