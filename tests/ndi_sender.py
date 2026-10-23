# A test NDI source made with the NDI library (the one nouPix would find, or NOUPIX_NDI_LIB): a picture whose
# left half is one colour and right half another, the colours changeable while it runs. Used by test_ndi.py.
import ctypes as C, os, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import noupix


class Sender:
    def __init__(self, name, w=320, h=180, fps=30):
        self.ndi = noupix.Ndi()
        if not self.ndi.lib:
            raise RuntimeError(self.ndi.note)
        lib = self.ndi.lib

        class SendCreate(C.Structure):
            _fields_ = [("p_ndi_name", C.c_char_p), ("p_groups", C.c_char_p), ("clock_video", C.c_bool), ("clock_audio", C.c_bool)]
        lib.NDIlib_send_create.restype, lib.NDIlib_send_create.argtypes = C.c_void_p, [C.POINTER(SendCreate)]
        lib.NDIlib_send_send_video_v2.restype, lib.NDIlib_send_send_video_v2.argtypes = None, [C.c_void_p, C.POINTER(self.ndi.VideoFrame)]
        lib.NDIlib_send_destroy.restype, lib.NDIlib_send_destroy.argtypes = None, [C.c_void_p]
        self.lib, self.w, self.h, self.fps = lib, w, h, fps
        self.s = lib.NDIlib_send_create(C.byref(SendCreate(name.encode(), None, True, False)))
        self.left, self.right, self.alive, self.sent = (255, 0, 0), (0, 0, 255), True, 0
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        w, h = self.w, self.h
        while self.alive:
            row = bytes(self.left + (255,)) * (w // 2) + bytes(self.right + (255,)) * (w - w // 2)
            buf = C.create_string_buffer(row * h, w * h * 4)
            vf = self.ndi.VideoFrame(w, h, int.from_bytes(b"RGBA", "little"), self.fps, 1, w / h, 1, 0x7FFFFFFFFFFFFFFF,
                                     C.cast(buf, C.c_void_p), w * 4, None, 0)
            self.lib.NDIlib_send_send_video_v2(self.s, C.byref(vf))   # clocked: waits for the frame's time
            self.sent += 1

    def close(self):
        self.alive = False
        time.sleep(0.2)
        self.lib.NDIlib_send_destroy(self.s)


if __name__ == "__main__":
    s = Sender(sys.argv[1] if len(sys.argv) > 1 else "nouPix test")
    print("sending", flush=True)
    while True:
        time.sleep(1)
