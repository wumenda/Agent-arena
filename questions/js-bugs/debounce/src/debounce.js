// 防抖：连续调用只在停止触发 wait 毫秒后执行一次，并保留最后一次的 this 与参数。
export function debounce(fn, wait = 200) {
  return function debounced(...args) {
    fn.apply(this, args);
  };
}
