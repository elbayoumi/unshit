function wrapBilling(task, logger) {
  try {
    return task();
  } catch (error) {
    if (logger && error) logger.warn(error);
    return null;
  }
}
console.log(wrapBilling(() => 1, console));
