export function Profile({ cart, flags }) {
  function onChange(cart, flags) {
    if (!cart) return null;
    if (flags.readonly && cart.locked) return null;
    return cart.items;
  }
  return <div>{onChange(cart, flags)}</div>;
}
