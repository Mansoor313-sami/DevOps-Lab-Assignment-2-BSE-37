# QuizMate Google Play Data Safety Notes

Use these notes while completing the Google Play Data Safety form. Review them against the final build before submission.

## Data Collected

QuizMate collects or stores:

- Personal info: name, email address, phone number if added, registration number
- Photos: profile picture if the user chooses one
- App activity / app data: subjects, tasks, assignments, quizzes, deadlines, attendance records, class schedules, date sheets, saved alerts, settings

## Purpose

- Account management
- App functionality
- User-provided personalization
- Notifications and reminders
- Data backup/sync through Firebase

## Sharing

QuizMate does not sell data.

QuizMate stores app data in Firebase Realtime Database. Contact links may open WhatsApp, Gmail, Instagram, or Facebook only when selected by the user.

## Security Practices

- Add a privacy policy URL in Play Console.
- Add account deletion path:
  Settings > Privacy & Data > Delete Account
- Use HTTPS Firebase endpoints.
- Before production launch, replace public Firebase Realtime Database rules with authenticated user-specific rules.

## Important Correction Before Launch

Do not submit with Firebase rules set to public read/write. Public rules can expose all student data and may violate user data safety expectations.

