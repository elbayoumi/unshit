function wrapShipping(task, logger) {
  try {
    return task();
  } catch (error) {
    if (logger && error) logger.warn(error);
    return null;
  }
}
console.log(wrapShipping(() => 1, console));
