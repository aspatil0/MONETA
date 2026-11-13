# MONETA – Personal Finance & Money Manager

**Take control of your money. Build better financial habits.**

MONETA is a modern personal finance and money management application designed to help users track income, manage expenses, monitor budgets, and understand their financial activities through an intuitive mobile experience.

---

## About MONETA

MONETA aims to simplify everyday financial management by bringing income tracking, expense management, budgeting, and financial insights into one place.

Whether you're managing your monthly salary, tracking daily spending, or planning your savings, MONETA helps you stay financially organized.

## Key Features

- **Income Management** – Record and manage income from multiple sources.
- **Expense Tracking** – Track daily expenses and categorize transactions.
- **Dashboard** – Get an overview of your financial activities.
- **Budget Management** – Organize spending and monitor your budgets.
- **Transaction History** – View and manage previous transactions.
- **Financial Insights** – Understand your spending patterns.
- **User-Friendly Interface** – Clean, modern, and intuitive mobile experience.

*Features may evolve as development progresses.*

## Technology Stack

| Technology | Purpose |
|---|---|
| React Native | Mobile application development |
| Expo | Development and build platform |
| TypeScript | Type-safe application development |
| Supabase | Backend and database integration |
| JavaScript | Application logic |

## Project Structure

```text
MONETA/
│
├── app/                 # Application routes and screens
├── assets/              # Images, icons and visual assets
├── modules/             # Feature modules
├── plugins/             # Expo plugins and configurations
├── src/                 # Application source code
├── logo/                # Brand assets
│
├── app.json             # Expo configuration
├── eas.json             # EAS Build configuration
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
└── README.md            # Project documentation
```

## Getting Started

### Prerequisites

Make sure you have installed:

- Node.js (LTS)
- npm
- Git
- Expo Go or an Android emulator
- Android Studio (for local Android development, if required)

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/aspatil0/MONETA.git
```

**2. Navigate to the project**

```bash
cd MONETA
```

**3. Install dependencies**

```bash
npm install
```

**4. Start the Expo development server**

```bash
npx expo start
```

Follow the terminal instructions to run the application on your device or emulator.

## Development & Build

To create a development build or production Android build, use Expo Application Services (EAS).

```bash
npx eas-cli build:configure
```

For an Android production build:

```bash
npx eas-cli build --platform android --profile production
```

## Security

- Never commit API keys, passwords, or private credentials.
- Keep environment variables in local `.env` files.
- Do not expose Supabase service-role keys in the mobile application.
- Use appropriate authentication and database access policies.

## Project Status

**Active Development**

MONETA is continuously evolving, with improvements to functionality, user experience, financial insights, and application performance.

## Repository

GitHub: https://github.com/aspatil0/MONETA

## Author

**Adityaraj Patil**

GitHub: [@aspatil0](https://github.com/aspatil0)

---

<p align="center">
  <strong>MONETA</strong><br/>
  Manage Money. Make Progress.
</p>
