/* A stand-in for libomt, built from libomt.h (Open Media Transport, MIT licence), for test_omt.py: one source,
   "NOUPIX-TEST (nouPix OMT)", sending BGRA frames 320 x 180 (40 x 23 as a preview) with rows padded past their width,
   the left half one colour and the right half another, read from the file named by FAKE_OMT_COLORS ("r g b r g b"). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "libomt.h"

static char *names[] = { "NOUPIX-TEST (nouPix OMT)" };
typedef struct { int flags; OMTMediaFrame frame; unsigned char *buf; } rx;

char **omt_discovery_getaddresses(int *count) { *count = 1; return names; }

omt_receive_t *omt_receive_create(const char *address, OMTFrameType types, OMTPreferredVideoFormat format, OMTReceiveFlags flags) {
  if (strcmp(address, names[0]) != 0 || !(types & OMTFrameType_Video) || format != OMTPreferredVideoFormat_BGRA) return NULL;
  rx *r = calloc(1, sizeof(rx));
  r->flags = flags;
  return (omt_receive_t *)r;
}
void omt_receive_destroy(omt_receive_t *instance) { rx *r = (rx *)instance; free(r->buf); free(r); }

OMTMediaFrame *omt_receive(omt_receive_t *instance, OMTFrameType types, int timeout) {
  rx *r = (rx *)instance;
  struct timespec ts = { 0, 33 * 1000000 };
  nanosleep(&ts, NULL);
  if (!(types & OMTFrameType_Video)) return NULL;
  int c[6] = { 255, 0, 0, 0, 0, 255 };
  const char *fn = getenv("FAKE_OMT_COLORS");
  FILE *f = fn ? fopen(fn, "r") : NULL;
  if (f) { if (fscanf(f, "%d %d %d %d %d %d", c, c + 1, c + 2, c + 3, c + 4, c + 5) != 6) c[0] = 255; fclose(f); }
  if (fn && !f) return NULL;   /* no file: the source has stopped */
  int w = (r->flags & OMTReceiveFlags_Preview) ? 40 : 320, h = (r->flags & OMTReceiveFlags_Preview) ? 23 : 180, stride = w * 4 + 16;
  r->buf = realloc(r->buf, stride * h);
  for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
    unsigned char *p = r->buf + y * stride + x * 4; int *k = x < w / 2 ? c : c + 3;
    p[0] = k[2]; p[1] = k[1]; p[2] = k[0]; p[3] = 255;   /* B G R A */
  }
  memset(&r->frame, 0, sizeof r->frame);
  r->frame.Type = OMTFrameType_Video; r->frame.Codec = OMTCodec_BGRA; r->frame.Width = w; r->frame.Height = h; r->frame.Stride = stride;
  r->frame.FrameRateN = 30; r->frame.FrameRateD = 1; r->frame.Data = r->buf; r->frame.DataLength = stride * h;
  if (r->flags & OMTReceiveFlags_Preview) r->frame.Flags = OMTVideoFlags_Preview;
  return &r->frame;
}
