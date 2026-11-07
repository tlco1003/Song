"""Pixels-as-frames training tests: synthetic fixtures only, not singing validation."""
import unittest
import torch
from song_vision.photo_pixel_memory_v17 import (
    PhotoPixelFrameMemory, supervised_pixel_memory_loss)
from song_vision.full_face_renderer_v14 import dynamic_region_masks


class PhotoMemoryTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(713)
        torch.set_num_threads(2)

    def test_reference_pixels_move_and_all_trainable_parts_get_gradients(self):
        model=PhotoPixelFrameMemory()
        ref=torch.rand(2,3,96,96)
        raw=torch.rand(2,4,3,96,96,requires_grad=True)
        motion=torch.randn(2,4,38)
        out=model(ref,raw,motion)
        self.assertEqual(out.shape,(2,4,3,96,96))
        mask,_=dynamic_region_masks()
        self.assertLess(float(((out-raw)*(1-mask)).abs().max()),1e-6)
        target=torch.rand_like(out)
        loss=supervised_pixel_memory_loss(out,raw,target)
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertGreater(float(model.refine[0].weight.grad.abs().sum()),0)
        self.assertGreater(float(model.motion_flow.weight.grad.abs().sum()),0)
        self.assertGreater(float(raw.grad.abs().sum()),0)

    def test_state_resets_and_frame_order_changes_output(self):
        model=PhotoPixelFrameMemory().eval()
        ref=torch.rand(1,3,96,96)
        raw=torch.rand(1,3,3,96,96)
        motions=torch.randn(1,3,38)
        with torch.no_grad():
            a=model(ref,raw,motions)
            b=model(ref,raw,motions)
            different=model(ref,raw.flip(1),motions.flip(1)).flip(1)
        self.assertTrue(torch.equal(a,b))
        self.assertGreater(float((a-different).abs().sum()),.001)

    def test_streaming_chunks_preserve_full_sequence_pixels(self):
        model=PhotoPixelFrameMemory().eval()
        reference=torch.rand(1,3,96,96)
        frames=torch.rand(1,6,3,96,96)
        motions=torch.randn(1,6,38)
        with torch.no_grad():
            complete=model(reference,frames,motions)
            first,state=model(reference,frames[:,:3],motions[:,:3],
                              return_state=True)
            second,state=model(reference,frames[:,3:],motions[:,3:],
                               state=state,return_state=True)
        self.assertTrue(torch.allclose(
            torch.cat((first,second),dim=1),complete,atol=1e-6))
        self.assertEqual(state['frame'].shape,reference.shape)
        with self.assertRaises(ValueError):
            model(reference,frames,motions,
                  state={'frame':torch.zeros(2,3,96,96),
                         'motion':torch.zeros(1,38)})

    def test_invalid_mismatched_frame_targets_fail_closed(self):
        model=PhotoPixelFrameMemory()
        reference=torch.zeros(1,3,96,96)
        source=torch.zeros(1,4,3,96,96)
        motions=torch.zeros(1,4,38)
        with self.assertRaises(ValueError):
            model(reference,source,motions[:,:3])
        with self.assertRaises(ValueError):
            supervised_pixel_memory_loss(source,source,source[:,:3])


if __name__=="__main__":
    unittest.main()
