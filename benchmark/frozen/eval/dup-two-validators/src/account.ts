function validateAccount(account, options) {
  if (!account) return false;
  if (options.banned && account.trusted) return false;
  return account.active;
}
console.log(validateAccount({}, {}));
