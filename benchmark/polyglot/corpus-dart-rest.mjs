// Second half of the Dart base project (see corpus-dart.mjs).

export function dartRest(rng, files, app) {
  files.set('lib/services/api_client.dart', `import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';

class ApiClient {
  ApiClient(this._config, this._client);

  final AppConfig _config;
  final http.Client _client;

  Future<Map<String, Object?>> get(String path) async {
    final response = await _client.get(Uri.parse(_config.baseUrl + path));
    if (response.statusCode != 200) {
      throw ApiException('GET ' + path + ' failed with ' + response.statusCode.toString());
    }
    return jsonDecode(response.body) as Map<String, Object?>;
  }
}

class ApiException implements Exception {
  ApiException(this.message);

  final String message;

  @override
  String toString() => 'ApiException: ' + message;
}
`);

  files.set('lib/services/auth_service.dart', `import 'storage.dart';

class AuthService {
  AuthService({required this.tokenStore});

  final Storage tokenStore;

  String? _token;

  Future<void> signIn(String email, String password) async {
    if (email.isEmpty || password.isEmpty) {
      throw ArgumentError('email and password are required');
    }
    _token = await tokenStore.read('session');
  }

  bool get isSignedIn => _token != null;
}
`);

  files.set('lib/services/cache_service.dart', `class CacheEntry {
  const CacheEntry(this.value, this.expiresAt);

  final String value;
  final DateTime expiresAt;

  bool isExpired(DateTime now) => now.isAfter(expiresAt);
}

class CacheService {
  final Map<String, CacheEntry> _entries = {};

  String? read(String key, {DateTime? now}) {
    final entry = _entries[key];
    if (entry == null) {
      return null;
    }
    if (entry.isExpired(now ?? DateTime.now())) {
      _entries.remove(key);
      return null;
    }
    return entry.value;
  }

  void write(String key, String value, Duration ttl) {
    _entries[key] = CacheEntry(value, DateTime.now().add(ttl));
  }
}
`);

  files.set('lib/services/storage.dart', `abstract class Storage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class MemoryStorage implements Storage {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    _values.remove(key);
  }
}
`);

  files.set('lib/services/logger.dart', `import 'package:flutter/foundation.dart';

class AppLogger {
  const AppLogger(this.name);

  final String name;

  void info(String message) {
    debugPrint('[' + name + '] ' + message);
  }

  void warn(String message) {
    debugPrint('[' + name + '] WARN ' + message);
  }
}
`);

  files.set('lib/repositories/user_repository.dart', `import '../api/endpoints.dart';
import '../models/user.dart';
import '../services/api_client.dart';

class UserRepository {
  UserRepository(this._client);

  final ApiClient _client;

  Future<User> fetch(String id) async {
    final json = await _client.get(Endpoints.user(id));
    return User.fromJson(json);
  }
}
`);

  files.set('lib/repositories/order_repository.dart', `import '../api/endpoints.dart';
import '../models/order.dart';
import '../services/api_client.dart';

class OrderRepository {
  OrderRepository(this._client);

  final ApiClient _client;

  Future<List<OrderLine>> list() async {
    final json = await _client.get(Endpoints.orders);
    final rows = json['items'] as List<Object?>? ?? const [];
    return rows.whereType<Map<String, Object?>>().map(OrderLine.fromJson).toList();
  }
}
`);

  files.set('lib/state/app_state.dart', `import 'package:flutter/foundation.dart';

import '../models/user.dart';

class AppState extends ChangeNotifier {
  User? _user;

  User? get user => _user;

  void setUser(User? user) {
    _user = user;
    notifyListeners();
  }
}
`);

  files.set('lib/state/cart_state.dart', `import 'package:flutter/foundation.dart';

import '../models/order.dart';

class CartState extends ChangeNotifier {
  final List<OrderLine> _lines = [];

  List<OrderLine> get lines => List.unmodifiable(_lines);

  int get totalItems => _lines.fold(0, (total, line) => total + line.quantity);

  void add(OrderLine line) {
    _lines.add(line);
    notifyListeners();
  }

  void clear() {
    _lines.clear();
    notifyListeners();
  }
}
`);
}
