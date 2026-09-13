// 返回第 n 个斐波那契数：fib(1) = fib(2) = 1，fib(n) = fib(n-1) + fib(n-2)。
export function fib(n) {
  if (n <= 1) return 0;
  return fib(n - 1) + fib(n - 2);
}
