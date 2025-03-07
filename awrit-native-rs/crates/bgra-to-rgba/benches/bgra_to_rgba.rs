use bgra_to_rgba::{bgra_to_rgba, bgra_to_rgba_rect, Rect};
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn create_test_buffer(size: usize) -> (Vec<u8>, Vec<u8>) {
  let mut src = vec![0u8; size];
  for i in 0..size {
    src[i] = (i % 256) as u8;
  }
  let dst = vec![0u8; size];
  (src, dst)
}

fn bench_bgra_to_rgba(c: &mut Criterion) {
  let mut group = c.benchmark_group("bgra_to_rgba");

  for size in [32, 256, 512, 1024, 128 * 128 * 4, 480 * 270 * 4, 512 * 1024 * 4, 200 * 600 * 4].iter() {
    let (src, mut dst) = create_test_buffer(*size);

    group.bench_function(format!("size_{}", size), |b| {
      b.iter(|| {
        bgra_to_rgba(black_box(&src), black_box(&mut dst));
      });
    });
  }

  group.finish();
}

fn bench_bgra_to_rgba_rect(c: &mut Criterion) {
    let mut group = c.benchmark_group("bgra_to_rgba_rect");

    // Test different image sizes and rectangle sizes
    let test_cases = [
        // (image_width, image_height, rect_width, rect_height, rect_x, rect_y)
        (512, 512, 128, 128, 0, 0),       // Small region at top-left
        (1920, 1080, 480, 270, 720, 405), // Quarter size region at center
        (1024, 1024, 1024, 512, 0, 256),  // Full width, half height
        (800, 600, 200, 600, 300, 0),     // Vertical strip
    ];

    for (img_w, img_h, rect_w, rect_h, x, y) in test_cases.iter() {
        let src_size = (img_w * img_h * 4) as usize;
        let dst_size = (rect_w * rect_h * 4) as usize;
        let (src, mut dst) = create_test_buffer(src_size);
        dst.truncate(dst_size);

        let rect = Rect {
            x: *x,
            y: *y,
            width: *rect_w,
            height: *rect_h,
        };

        group.bench_function(
            format!("{}x{}_rect_{}x{}_at_{}_{}_size_{}", img_w, img_h, rect_w, rect_h, x, y, rect_w * rect_h * 4),
            |b| {
                b.iter(|| {
                    bgra_to_rgba_rect(
                        black_box(&src),
                        black_box(&mut dst),
                        black_box(*img_w),
                        black_box(rect),
                    );
                });
            },
        );
    }

    group.finish();
}

criterion_group!(benches, bench_bgra_to_rgba, bench_bgra_to_rgba_rect);
criterion_main!(benches);
