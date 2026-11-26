// Third part of the Dart base project (see corpus-dart.mjs).

export function dartTail(rng, files, app) {
  files.set('lib/screens/home_screen.dart', `import 'package:flutter/material.dart';

import '../widgets/card.dart';
import '../widgets/empty_state.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ledger')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const [SummaryCard(), EmptyState(message: 'No activity yet')],
      ),
    );
  }
}
`);

  files.set('lib/screens/detail_screen.dart', `import 'package:flutter/material.dart';

class DetailScreen extends StatelessWidget {
  const DetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Detail')),
      body: const Center(child: Text('Nothing selected')),
    );
  }
}
`);

  files.set('lib/screens/settings_screen.dart', `import 'package:flutter/material.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: const [
          ListTile(title: Text('Account'), subtitle: Text('ops@example.com')),
          ListTile(title: Text('Notifications'), subtitle: Text('Enabled')),
        ],
      ),
    );
  }
}
`);

  files.set('lib/widgets/button.dart', `import 'package:flutter/material.dart';

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(onPressed: onPressed, child: Text(label));
  }
}
`);

  files.set('lib/widgets/card.dart', `import 'package:flutter/material.dart';

class SummaryCard extends StatelessWidget {
  const SummaryCard({super.key});

  @override
  Widget build(BuildContext context) {
    return const Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Text('This month'),
      ),
    );
  }
}
`);

  files.set('lib/widgets/avatar.dart', `import 'package:flutter/material.dart';

class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(child: Text(initials));
  }
}
`);

  files.set('lib/widgets/empty_state.dart', `import 'package:flutter/material.dart';

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Center(child: Text(message)),
    );
  }
}
`);

  files.set('lib/utils/formatters.dart', `String formatCents(int cents, {String currency = 'USD'}) {
  final sign = cents < 0 ? '-' : '';
  final absolute = cents.abs();
  final whole = absolute ~/ 100;
  final fraction = (absolute % 100).toString().padLeft(2, '0');
  return sign + whole.toString() + '.' + fraction + ' ' + currency;
}

String formatPercent(double value, double total) {
  if (total <= 0) {
    return '0.0%';
  }
  return (value / total * 100).toStringAsFixed(1) + '%';
}
`);

  files.set('lib/utils/validators.dart', `final RegExp _emailPattern = RegExp(r'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');

String requireText(String field, String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    throw ArgumentError(field + ' must not be empty');
  }
  return trimmed;
}

String requireEmail(String value) {
  final email = requireText('email', value);
  if (!_emailPattern.hasMatch(email)) {
    throw ArgumentError('email format is invalid');
  }
  return email;
}
`);

  files.set('lib/utils/dates.dart', `String relativeTime(DateTime then, {DateTime? now}) {
  final current = now ?? DateTime.now();
  final delta = current.difference(then);
  if (delta.inMinutes < 1) {
    return 'just now';
  }
  if (delta.inHours < 1) {
    return delta.inMinutes.toString() + 'm ago';
  }
  if (delta.inDays < 1) {
    return delta.inHours.toString() + 'h ago';
  }
  return delta.inDays.toString() + 'd ago';
}
`);

  files.set('lib/theme/colors.dart', `import 'package:flutter/material.dart';

class AppColors {
  const AppColors._();

  static const Color accent = Color(0xFF2F6FED);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color text = Color(0xFF1B1F24);
  static const Color danger = Color(0xFFC0392B);
}
`);

  files.set('lib/theme/text_styles.dart', `import 'package:flutter/material.dart';

class AppTextStyles {
  const AppTextStyles._();

  static const TextStyle title = TextStyle(fontSize: 20, fontWeight: FontWeight.w700);
  static const TextStyle body = TextStyle(fontSize: 14, height: 1.5);
  static const TextStyle caption = TextStyle(fontSize: 12);
}
`);

  files.set('test/widget_test.dart', `import 'package:flutter_test/flutter_test.dart';

import 'package:${app}/app.dart';

void main() {
  testWidgets('renders the app shell', (tester) async {
    await tester.pumpWidget(const LedgerApp());
    expect(find.text('Ledger'), findsOneWidget);
  });
}
`);
}
