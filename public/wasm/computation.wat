;; WebAssembly Text Format - High-Performance Matrix & Vector Computations
;; Compile with: wat2wasm computation.wat -o computation.wasm

(module
  ;; Memory: 256 pages (16MB) - expandable
  (memory (export "memory") 256 512)

  ;; Global state for memory allocation
  (global $heap_ptr (mut i32) (i32.const 65536))  ;; Start after first 64KB reserved
  (global $stack_ptr (mut i32) (i32.const 65536))

  ;; ============================================
  ;; MEMORY MANAGEMENT
  ;; ============================================

  ;; Simple bump allocator - returns pointer to allocated memory
  (func (export "allocate") (param $size i32) (result i32)
    (local $ptr i32)
    (local $aligned_size i32)

    ;; Align to 8 bytes for f64
    (local.set $aligned_size
      (i32.and
        (i32.add (local.get $size) (i32.const 7))
        (i32.const -8)))

    ;; Get current heap pointer
    (local.set $ptr (global.get $heap_ptr))

    ;; Advance heap pointer
    (global.set $heap_ptr
      (i32.add (global.get $heap_ptr) (local.get $aligned_size)))

    ;; Return allocated pointer
    (local.get $ptr)
  )

  ;; Reset allocator (for cleanup)
  (func (export "reset_heap")
    (global.set $heap_ptr (i32.const 65536))
  )

  ;; Get current heap usage
  (func (export "get_heap_usage") (result i32)
    (i32.sub (global.get $heap_ptr) (i32.const 65536))
  )

  ;; ============================================
  ;; VECTOR OPERATIONS (SIMD-ready structure)
  ;; ============================================

  ;; Vector dot product: sum(a[i] * b[i])
  (func (export "vec_dot") (param $a_ptr i32) (param $b_ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $sum f64)
    (local $offset i32)

    (local.set $sum (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))

        (local.set $sum
          (f64.add
            (local.get $sum)
            (f64.mul
              (f64.load (i32.add (local.get $a_ptr) (local.get $offset)))
              (f64.load (i32.add (local.get $b_ptr) (local.get $offset))))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
    (local.get $sum)
  )

  ;; Vector magnitude: sqrt(sum(v[i]^2))
  (func (export "vec_magnitude") (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $sum f64)
    (local $val f64)
    (local $offset i32)

    (local.set $sum (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $val (f64.load (i32.add (local.get $ptr) (local.get $offset))))

        (local.set $sum
          (f64.add
            (local.get $sum)
            (f64.mul (local.get $val) (local.get $val))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
    (f64.sqrt (local.get $sum))
  )

  ;; Vector normalize in-place
  (func (export "vec_normalize") (param $ptr i32) (param $len i32)
    (local $i i32)
    (local $mag f64)
    (local $offset i32)

    ;; Calculate magnitude
    (local.set $mag (call $vec_magnitude_internal (local.get $ptr) (local.get $len)))

    ;; Avoid division by zero
    (if (f64.gt (local.get $mag) (f64.const 0.0000001))
      (then
        (local.set $i (i32.const 0))
        (block $break
          (loop $continue
            (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

            (local.set $offset (i32.shl (local.get $i) (i32.const 3)))

            (f64.store
              (i32.add (local.get $ptr) (local.get $offset))
              (f64.div
                (f64.load (i32.add (local.get $ptr) (local.get $offset)))
                (local.get $mag)))

            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $continue)
          )
        )
      )
    )
  )

  ;; Internal magnitude function
  (func $vec_magnitude_internal (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $sum f64)
    (local $val f64)
    (local $offset i32)

    (local.set $sum (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $val (f64.load (i32.add (local.get $ptr) (local.get $offset))))

        (local.set $sum (f64.add (local.get $sum) (f64.mul (local.get $val) (local.get $val))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
    (f64.sqrt (local.get $sum))
  )

  ;; Vector addition: result[i] = a[i] + b[i]
  (func (export "vec_add") (param $a_ptr i32) (param $b_ptr i32) (param $result_ptr i32) (param $len i32)
    (local $i i32)
    (local $offset i32)

    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))

        (f64.store
          (i32.add (local.get $result_ptr) (local.get $offset))
          (f64.add
            (f64.load (i32.add (local.get $a_ptr) (local.get $offset)))
            (f64.load (i32.add (local.get $b_ptr) (local.get $offset)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
  )

  ;; Vector scale: result[i] = v[i] * scalar
  (func (export "vec_scale") (param $v_ptr i32) (param $result_ptr i32) (param $len i32) (param $scalar f64)
    (local $i i32)
    (local $offset i32)

    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))

        (f64.store
          (i32.add (local.get $result_ptr) (local.get $offset))
          (f64.mul
            (f64.load (i32.add (local.get $v_ptr) (local.get $offset)))
            (local.get $scalar)))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
  )

  ;; ============================================
  ;; MATRIX OPERATIONS
  ;; ============================================

  ;; Matrix multiply: C = A * B (row-major order)
  ;; A: m x k, B: k x n, C: m x n
  (func (export "mat_multiply")
    (param $a_ptr i32) (param $b_ptr i32) (param $c_ptr i32)
    (param $m i32) (param $k i32) (param $n i32)
    (local $i i32) (local $j i32) (local $l i32)
    (local $sum f64)
    (local $a_offset i32) (local $b_offset i32) (local $c_offset i32)

    (local.set $i (i32.const 0))

    (block $break_i
      (loop $loop_i
        (br_if $break_i (i32.ge_u (local.get $i) (local.get $m)))

        (local.set $j (i32.const 0))

        (block $break_j
          (loop $loop_j
            (br_if $break_j (i32.ge_u (local.get $j) (local.get $n)))

            (local.set $sum (f64.const 0))
            (local.set $l (i32.const 0))

            (block $break_l
              (loop $loop_l
                (br_if $break_l (i32.ge_u (local.get $l) (local.get $k)))

                ;; A[i][l] offset: (i * k + l) * 8
                (local.set $a_offset
                  (i32.shl
                    (i32.add
                      (i32.mul (local.get $i) (local.get $k))
                      (local.get $l))
                    (i32.const 3)))

                ;; B[l][j] offset: (l * n + j) * 8
                (local.set $b_offset
                  (i32.shl
                    (i32.add
                      (i32.mul (local.get $l) (local.get $n))
                      (local.get $j))
                    (i32.const 3)))

                (local.set $sum
                  (f64.add
                    (local.get $sum)
                    (f64.mul
                      (f64.load (i32.add (local.get $a_ptr) (local.get $a_offset)))
                      (f64.load (i32.add (local.get $b_ptr) (local.get $b_offset))))))

                (local.set $l (i32.add (local.get $l) (i32.const 1)))
                (br $loop_l)
              )
            )

            ;; C[i][j] offset: (i * n + j) * 8
            (local.set $c_offset
              (i32.shl
                (i32.add
                  (i32.mul (local.get $i) (local.get $n))
                  (local.get $j))
                (i32.const 3)))

            (f64.store
              (i32.add (local.get $c_ptr) (local.get $c_offset))
              (local.get $sum))

            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $loop_j)
          )
        )

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_i)
      )
    )
  )

  ;; Matrix transpose: B = A^T
  (func (export "mat_transpose")
    (param $a_ptr i32) (param $b_ptr i32) (param $rows i32) (param $cols i32)
    (local $i i32) (local $j i32)
    (local $a_offset i32) (local $b_offset i32)

    (local.set $i (i32.const 0))

    (block $break_i
      (loop $loop_i
        (br_if $break_i (i32.ge_u (local.get $i) (local.get $rows)))

        (local.set $j (i32.const 0))

        (block $break_j
          (loop $loop_j
            (br_if $break_j (i32.ge_u (local.get $j) (local.get $cols)))

            ;; A[i][j] -> B[j][i]
            (local.set $a_offset
              (i32.shl
                (i32.add (i32.mul (local.get $i) (local.get $cols)) (local.get $j))
                (i32.const 3)))

            (local.set $b_offset
              (i32.shl
                (i32.add (i32.mul (local.get $j) (local.get $rows)) (local.get $i))
                (i32.const 3)))

            (f64.store
              (i32.add (local.get $b_ptr) (local.get $b_offset))
              (f64.load (i32.add (local.get $a_ptr) (local.get $a_offset))))

            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $loop_j)
          )
        )

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_i)
      )
    )
  )

  ;; Frobenius norm: sqrt(sum(A[i][j]^2))
  (func (export "mat_frobenius_norm") (param $ptr i32) (param $size i32) (result f64)
    (call $vec_magnitude_internal (local.get $ptr) (local.get $size))
  )

  ;; ============================================
  ;; STATISTICAL OPERATIONS
  ;; ============================================

  ;; Mean of array
  (func (export "stats_mean") (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $sum f64)
    (local $offset i32)

    (if (i32.eqz (local.get $len))
      (then (return (f64.const 0))))

    (local.set $sum (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $sum
          (f64.add (local.get $sum) (f64.load (i32.add (local.get $ptr) (local.get $offset)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )

    (f64.div (local.get $sum) (f64.convert_i32_u (local.get $len)))
  )

  ;; Variance of array
  (func (export "stats_variance") (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $mean f64)
    (local $sum_sq f64)
    (local $diff f64)
    (local $offset i32)

    (if (i32.le_u (local.get $len) (i32.const 1))
      (then (return (f64.const 0))))

    ;; Calculate mean first
    (local.set $mean (call $stats_mean_internal (local.get $ptr) (local.get $len)))

    (local.set $sum_sq (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $diff
          (f64.sub (f64.load (i32.add (local.get $ptr) (local.get $offset))) (local.get $mean)))
        (local.set $sum_sq
          (f64.add (local.get $sum_sq) (f64.mul (local.get $diff) (local.get $diff))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )

    (f64.div (local.get $sum_sq) (f64.convert_i32_u (i32.sub (local.get $len) (i32.const 1))))
  )

  ;; Standard deviation
  (func (export "stats_std_dev") (param $ptr i32) (param $len i32) (result f64)
    (f64.sqrt (call $stats_variance_internal (local.get $ptr) (local.get $len)))
  )

  ;; Internal mean function
  (func $stats_mean_internal (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $sum f64)
    (local $offset i32)

    (if (i32.eqz (local.get $len))
      (then (return (f64.const 0))))

    (local.set $sum (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $sum
          (f64.add (local.get $sum) (f64.load (i32.add (local.get $ptr) (local.get $offset)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )

    (f64.div (local.get $sum) (f64.convert_i32_u (local.get $len)))
  )

  ;; Internal variance function
  (func $stats_variance_internal (param $ptr i32) (param $len i32) (result f64)
    (local $i i32)
    (local $mean f64)
    (local $sum_sq f64)
    (local $diff f64)
    (local $offset i32)

    (if (i32.le_u (local.get $len) (i32.const 1))
      (then (return (f64.const 0))))

    (local.set $mean (call $stats_mean_internal (local.get $ptr) (local.get $len)))

    (local.set $sum_sq (f64.const 0))
    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $diff
          (f64.sub (f64.load (i32.add (local.get $ptr) (local.get $offset))) (local.get $mean)))
        (local.set $sum_sq
          (f64.add (local.get $sum_sq) (f64.mul (local.get $diff) (local.get $diff))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )

    (f64.div (local.get $sum_sq) (f64.convert_i32_u (i32.sub (local.get $len) (i32.const 1))))
  )

  ;; ============================================
  ;; SIGNAL PROCESSING
  ;; ============================================

  ;; Simple moving average (in-place)
  (func (export "signal_moving_avg") (param $input_ptr i32) (param $output_ptr i32) (param $len i32) (param $window i32)
    (local $i i32)
    (local $j i32)
    (local $sum f64)
    (local $start i32)
    (local $end i32)
    (local $count i32)
    (local $offset i32)

    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        ;; Calculate window bounds
        (local.set $start
          (select
            (i32.const 0)
            (i32.sub (local.get $i) (i32.div_u (local.get $window) (i32.const 2)))
            (i32.lt_s (i32.sub (local.get $i) (i32.div_u (local.get $window) (i32.const 2))) (i32.const 0))))

        (local.set $end
          (select
            (local.get $len)
            (i32.add (local.get $i) (i32.div_u (local.get $window) (i32.const 2)) (i32.const 1))
            (i32.gt_u (i32.add (local.get $i) (i32.div_u (local.get $window) (i32.const 2)) (i32.const 1)) (local.get $len))))

        (local.set $sum (f64.const 0))
        (local.set $count (i32.const 0))
        (local.set $j (local.get $start))

        (block $inner_break
          (loop $inner_continue
            (br_if $inner_break (i32.ge_u (local.get $j) (local.get $end)))

            (local.set $offset (i32.shl (local.get $j) (i32.const 3)))
            (local.set $sum
              (f64.add (local.get $sum) (f64.load (i32.add (local.get $input_ptr) (local.get $offset)))))
            (local.set $count (i32.add (local.get $count) (i32.const 1)))

            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $inner_continue)
          )
        )

        ;; Store average
        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (f64.store
          (i32.add (local.get $output_ptr) (local.get $offset))
          (f64.div (local.get $sum) (f64.convert_i32_u (local.get $count))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
  )

  ;; Convolution: result = input * kernel
  (func (export "signal_convolve")
    (param $input_ptr i32) (param $kernel_ptr i32) (param $output_ptr i32)
    (param $input_len i32) (param $kernel_len i32)
    (local $i i32) (local $j i32)
    (local $sum f64)
    (local $input_idx i32)
    (local $kernel_offset i32) (local $input_offset i32) (local $output_offset i32)

    (local.set $i (i32.const 0))

    (block $break_i
      (loop $loop_i
        (br_if $break_i (i32.ge_u (local.get $i) (local.get $input_len)))

        (local.set $sum (f64.const 0))
        (local.set $j (i32.const 0))

        (block $break_j
          (loop $loop_j
            (br_if $break_j (i32.ge_u (local.get $j) (local.get $kernel_len)))

            (local.set $input_idx
              (i32.sub
                (i32.add (local.get $i) (i32.div_u (local.get $kernel_len) (i32.const 2)))
                (local.get $j)))

            ;; Check bounds
            (if (i32.and
                  (i32.ge_s (local.get $input_idx) (i32.const 0))
                  (i32.lt_u (local.get $input_idx) (local.get $input_len)))
              (then
                (local.set $input_offset (i32.shl (local.get $input_idx) (i32.const 3)))
                (local.set $kernel_offset (i32.shl (local.get $j) (i32.const 3)))

                (local.set $sum
                  (f64.add
                    (local.get $sum)
                    (f64.mul
                      (f64.load (i32.add (local.get $input_ptr) (local.get $input_offset)))
                      (f64.load (i32.add (local.get $kernel_ptr) (local.get $kernel_offset))))))))

            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $loop_j)
          )
        )

        (local.set $output_offset (i32.shl (local.get $i) (i32.const 3)))
        (f64.store
          (i32.add (local.get $output_ptr) (local.get $output_offset))
          (local.get $sum))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop_i)
      )
    )
  )

  ;; ============================================
  ;; PARALLEL COMPUTATION HELPERS
  ;; ============================================

  ;; Process chunk of array (for parallel processing)
  (func (export "process_chunk_sum") (param $ptr i32) (param $start i32) (param $end i32) (result f64)
    (local $i i32)
    (local $sum f64)
    (local $offset i32)

    (local.set $sum (f64.const 0))
    (local.set $i (local.get $start))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $end)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (local.set $sum
          (f64.add (local.get $sum) (f64.load (i32.add (local.get $ptr) (local.get $offset)))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
    (local.get $sum)
  )

  ;; Copy memory region
  (func (export "mem_copy") (param $src i32) (param $dst i32) (param $len i32)
    (memory.copy (local.get $dst) (local.get $src) (local.get $len))
  )

  ;; Fill memory with value
  (func (export "mem_fill_f64") (param $ptr i32) (param $len i32) (param $value f64)
    (local $i i32)
    (local $offset i32)

    (local.set $i (i32.const 0))

    (block $break
      (loop $continue
        (br_if $break (i32.ge_u (local.get $i) (local.get $len)))

        (local.set $offset (i32.shl (local.get $i) (i32.const 3)))
        (f64.store (i32.add (local.get $ptr) (local.get $offset)) (local.get $value))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $continue)
      )
    )
  )
)
