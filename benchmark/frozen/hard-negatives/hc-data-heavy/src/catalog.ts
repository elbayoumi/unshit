const catalog = {
  en: { title: 'Orders', empty: 'No orders', retry: 'Try again', help: 'Need help?' },
  ar: { title: 'الطلبات', empty: 'لا توجد طلبات', retry: 'حاول مرة أخرى', help: 'تحتاج مساعدة؟' },
  fr: { title: 'Commandes', empty: 'Aucune commande', retry: 'Reessayer', help: 'Aide?' },
  de: { title: 'Bestellungen', empty: 'Keine Bestellungen', retry: 'Erneut', help: 'Hilfe?' },
  es: { title: 'Pedidos', empty: 'Sin pedidos', retry: 'Reintentar', help: 'Ayuda?' },
  it: { title: 'Ordini', empty: 'Nessun ordine', retry: 'Riprova', help: 'Aiuto?' },
};
console.log(Object.keys(catalog));
