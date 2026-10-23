"""Re-encode short effects with local CoreAudio decoding and libmp3lame."""
import ctypes
import json
import os
import subprocess
import sys
import tempfile
import wave


def compress(source, target):
    library = os.environ["LAME_LIBRARY"]
    lame = ctypes.CDLL(library)
    lame.lame_init.restype = ctypes.c_void_p
    for name in ["lame_set_in_samplerate", "lame_set_num_channels", "lame_set_brate", "lame_set_quality"]:
        getattr(lame, name).argtypes = [ctypes.c_void_p, ctypes.c_int]
    lame.lame_init_params.argtypes = [ctypes.c_void_p]
    lame.lame_encode_buffer.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                                       ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    lame.lame_encode_flush.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int]
    lame.lame_get_lametag_frame.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    lame.lame_get_lametag_frame.restype = ctypes.c_size_t
    lame.lame_close.argtypes = [ctypes.c_void_p]
    with tempfile.TemporaryDirectory(prefix="cabin-sfx-") as folder:
        pcm = os.path.join(folder, "decoded.wav")
        subprocess.run(["/usr/bin/afconvert", source, pcm, "-f", "WAVE", "-d", "LEI16", "-c", "1"], check=True)
        with wave.open(pcm, "rb") as audio:
            if audio.getsampwidth() != 2 or audio.getnchannels() != 1:
                raise ValueError("Expected mono 16-bit PCM")
            rate = audio.getframerate()
            samples = audio.getnframes()
            handle = lame.lame_init()
            if not handle:
                raise RuntimeError("LAME initialization failed")
            try:
                for name, value in [("lame_set_in_samplerate", rate), ("lame_set_num_channels", 1),
                                    ("lame_set_brate", 64), ("lame_set_quality", 2)]:
                    if getattr(lame, name)(handle, value) < 0:
                        raise RuntimeError(name)
                if lame.lame_init_params(handle) < 0:
                    raise RuntimeError("Invalid MP3 parameters")
                output = ctypes.create_string_buffer(65536)
                with open(target, "wb+") as result:
                    while True:
                        data = audio.readframes(8192)
                        if not data:
                            break
                        block = ctypes.create_string_buffer(data)
                        count = lame.lame_encode_buffer(handle, block, block, len(data) // 2, output, len(output))
                        if count < 0:
                            raise RuntimeError("MP3 encode failed")
                        result.write(output.raw[:count])
                    count = lame.lame_encode_flush(handle, output, len(output))
                    if count < 0:
                        raise RuntimeError("MP3 flush failed")
                    result.write(output.raw[:count])
                    count = lame.lame_get_lametag_frame(handle, output, len(output))
                    if not 0 < count <= len(output):
                        raise RuntimeError("Missing gapless duration metadata")
                    result.seek(0)
                    result.write(output.raw[:count])
            finally:
                lame.lame_close(handle)
    print(json.dumps({"sample_rate": rate, "channels": 1, "bit_rate": 64000,
                      "decoded_samples": samples, "duration_seconds": samples / rate,
                      "bytes": os.path.getsize(target)}))


if __name__ == "__main__":
    compress(sys.argv[1], sys.argv[2])
