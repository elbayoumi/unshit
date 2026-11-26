class Repository {
  find(id: string): string {
    try {
      return this.load(id);
    } catch {
    }
    return '';
  }
  private load(id: string): string { return id; }
}
console.log(new Repository().find('1'));
