# QuizMate

QuizMate is an Expo React Native semester manager for students.

## Features

- Email or Reg No login through Firebase Realtime Database REST API
- User-scoped subjects, tasks, calendar deadlines, alerts, settings, and profile
- Deadline notifications with Android notification channel support
- Profile picture upload
- Contact Us screen with WhatsApp, Gmail, Instagram, and Facebook links
- Responsive phone and tablet layout

## Run

```bash
npm install
npm start
```

For reliable scheduled notifications, test on a real Android development build/APK instead of only the web preview.

## DevOps Lab Assignment 2 (BSE_37)

The Lab 1 `Dockerfile` is kept at the project root. Both GitHub Actions workflows build it when changes are pushed to `main`, and they can also be started manually:

- `.github/workflows/docker-commands.yml` uses Docker CLI commands.
- `.github/workflows/docker-actions.yml` uses Docker's GitHub Actions.

Each workflow builds the image without credentials. To enable publishing to Docker Hub, add repository Actions secrets named `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` in **Settings → Secrets and variables → Actions**. Use a Docker Hub access token for `DOCKERHUB_TOKEN`; never commit or paste the token into source files. Publishing runs only on `main` when both secrets are present. The image name is `<Docker Hub username>/quizmate-bse-37`.

Run the Docker image locally with:

```bash
docker build -t quizmate-bse-37:local .
docker run --rm -p 8081:8081 quizmate-bse-37:local
```

Then open `http://localhost:8081`. Docker Desktop must be running for these commands.
