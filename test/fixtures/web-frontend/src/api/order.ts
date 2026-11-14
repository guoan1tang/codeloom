export async function submitOrder(payload: unknown) {
  const res = await fetch('/orders', { method: 'POST' });
  return res;
}