// Deterministic, idiomatic Dart/Flutter project for the polyglot recall
// benchmark. The base avoids `dynamic` escapes and `print()` calls; it uses
// `Object?`, typed maps and `debugPrint` instead. `test/` is included on
// purpose to exercise the detector's test-path exclusion.

import { pick } from './lib.mjs';
import { dartRest } from './corpus-dart-rest.mjs';
import { dartTail } from './corpus-dart-tail.mjs';

export function dartFiles(rng, files) {
  const app = pick(rng, ['ledger_app', 'atlas_app', 'harbor_app', 'summit_app']);
  const baseUrl = pick(rng, ['https://api.example.com', 'https://api.example.org', 'https://api.example.net']);
  const timeout = 5 + Math.floor(rng() * 10);

  files.set('pubspec.yaml', `name: ${app}
environment:
  sdk: '>=3.4.0 <4.0.0'
dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.0
`);

  files.set('lib/main.dart', `import 'package:flutter/material.dart';

import 'app.dart';

void main() {
  runApp(const LedgerApp());
}
`);

  files.set('lib/app.dart', `import 'package:flutter/material.dart';

import 'router.dart';
import 'theme/colors.dart';

class LedgerApp extends StatelessWidget {
  const LedgerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ledger',
      theme: ThemeData(colorSchemeSeed: AppColors.accent),
      onGenerateRoute: buildRoute,
    );
  }
}
`);

  files.set('lib/config.dart', `class AppConfig {
  const AppConfig({required this.baseUrl, required this.timeout});

  final String baseUrl;
  final Duration timeout;

  static const AppConfig production = AppConfig(
    baseUrl: '${baseUrl}',
    timeout: Duration(seconds: ${timeout}),
  );
}
`);

  files.set('lib/router.dart', `import 'package:flutter/material.dart';

import 'screens/detail_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

Route<Object?> buildRoute(RouteSettings settings) {
  switch (settings.name) {
    case '/':
      return MaterialPageRoute(builder: (_) => const HomeScreen());
    case '/detail':
      return MaterialPageRoute(builder: (_) => const DetailScreen());
    case '/settings':
      return MaterialPageRoute(builder: (_) => const SettingsScreen());
    default:
      return MaterialPageRoute(builder: (_) => const HomeScreen());
  }
}
`);

  files.set('lib/api/endpoints.dart', `class Endpoints {
  const Endpoints._();

  static const String users = '/users';
  static const String orders = '/orders';
  static const String health = '/health';

  static String user(String id) => '$users/$id';
}
`);

  files.set('lib/models/user.dart', `class User {
  const User({required this.id, required this.email, this.active = true});

  final String id;
  final String email;
  final bool active;

  factory User.fromJson(Map<String, Object?> json) {
    return User(
      id: json['id']! as String,
      email: json['email']! as String,
      active: json['active'] as bool? ?? true,
    );
  }

  Map<String, Object?> toJson() => {'id': id, 'email': email, 'active': active};
}
`);

  files.set('lib/models/order.dart', `class OrderLine {
  const OrderLine({required this.productId, required this.quantity});

  final String productId;
  final int quantity;

  factory OrderLine.fromJson(Map<String, Object?> json) {
    return OrderLine(
      productId: json['product_id']! as String,
      quantity: json['quantity']! as int,
    );
  }
}
`);

  files.set('lib/models/product.dart', `class Product {
  const Product({required this.id, required this.name, required this.priceCents});

  final String id;
  final String name;
  final int priceCents;

  factory Product.fromJson(Map<String, Object?> json) {
    return Product(
      id: json['id']! as String,
      name: json['name']! as String,
      priceCents: json['price_cents']! as int,
    );
  }
}
`);

  files.set('lib/models/json.dart', `typedef JsonMap = Map<String, Object?>;

JsonMap asJsonMap(Object? value) {
  if (value is JsonMap) {
    return value;
  }
  throw FormatException('expected a JSON object, got ' + value.toString());
}
`);
  dartRest(rng, files, app);
  dartTail(rng, files, app);
}
