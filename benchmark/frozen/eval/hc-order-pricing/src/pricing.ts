type Order = { items: Array<{ price: number; qty: number }>; coupon?: string; vip: boolean };
function priceOrder(order: Order): number {
  let total = 0;
  for (const item of order.items) {
    if (item.qty > 0) {
      total += item.price * item.qty;
    } else if (item.qty < 0) {
      total -= item.price;
    }
  }
  if (order.coupon && order.vip) {
    total *= 0.8;
  }
  if (!order.vip) {
    total += 5;
  }
  while (total < 0) total = 0;
  return total;
}
console.log(priceOrder({ items: [], vip: false }));
