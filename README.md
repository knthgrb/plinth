# Plinth - HR Management System

A comprehensive HR management application for Philippine businesses with payroll processing, employee management, leave tracking, recruitment, and memo management.

## Features

### Core Modules

1. **Authentication & Organization Management**
   - Multi-tenant organization system
   - Role-based access control (Admin, HR Manager, Employee)
   - Organization signup flow with admin account creation
   - User invitation system

2. **Employee Records Management**
   - Complete employee profile management
   - Personal information, employment details, compensation
   - Schedule management with overrides
   - Leave credits tracking
   - Requirements and document tracking
   - Custom deductions and incentives

3. **Payroll System (Philippine Labor Code Compliant)**
   - Daily attendance encoding
   - Philippine holidays management (2025-2030)
   - Automatic deduction calculations:
     - SSS (Social Security System)
     - PhilHealth
     - Pag-IBIG
     - Withholding Tax (TRAIN Law compliant)
   - Custom deductions (loans, advances, etc.)
   - Payroll computation engine
   - Payslip generation
   - Multiple cutoff periods support

4. **Leave Management**
   - Leave request filing
   - Multi-level approval workflow
   - Leave balance tracking
   - Leave calendar view
   - Custom leave types

5. **Requirements Tracking**
   - Pre-defined Philippine employment requirements
   - Document upload and tracking
   - Status management (pending, submitted, verified)
   - Expiration alerts

6. **Recruitment Management**
   - Job posting management
   - Applicant tracking system
   - Interview scheduling
   - Convert applicant to employee

7. **Memo Management**
   - Rich text memo creation
   - Target audience selection
   - Acknowledgement tracking
   - Priority levels

8. **Dashboard & Analytics**
   - Organization overview
   - Quick statistics
   - Recent activity
   - Quick actions

## Tech Stack

- **Frontend & Backend**: Next.js 15 (App Router)
- **Database & Backend**: Convex
- **Authentication**: Better Auth
- **UI**: Tailwind CSS + shadcn/ui components
- **State Management**: Zustand (ready for use)
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Convex account (sign up at [convex.dev](https://convex.dev))

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd purple-pay
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:
   Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_CONVEX_URL=your_convex_url
SITE_URL=http://localhost:3000
```

4. Set up Convex:

```bash
npx convex dev
```

This will:

- Create a new Convex project (if needed)
- Generate the Convex schema
- Set up the database tables

5. Run the development server:

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

### First Time Setup

1. Navigate to `/signup` to create your organization account
2. Fill in your organization details and admin account information
3. You'll be automatically logged in and redirected to the dashboard
4. Start by adding employees in the Employees section

## Project Structure

```
purple-pay/
├── app/                    # Next.js app router pages
│   ├── dashboard/          # Dashboard page
│   ├── employees/          # Employee management
│   ├── attendance/         # Attendance tracking
│   ├── payroll/            # Payroll processing
│   ├── leave/              # Leave management
│   ├── requirements/       # Requirements tracking
│   ├── recruitment/        # Recruitment module
│   ├── memos/              # Memo management
│   ├── settings/           # Settings page
│   ├── login/              # Login page
│   └── signup/             # Signup page
├── components/             # React components
│   ├── ui/                 # shadcn/ui components
│   └── layout/             # Layout components
├── convex/                  # Convex backend functions
│   ├── schema.ts           # Database schema
│   ├── auth.ts             # Authentication setup
│   ├── organizations.ts    # Organization functions
│   ├── employees.ts        # Employee functions
│   ├── attendance.ts       # Attendance functions
│   ├── payroll.ts          # Payroll functions
│   ├── holidays.ts         # Holidays management
│   ├── leave.ts            # Leave functions
│   ├── recruitment.ts      # Recruitment functions
│   └── memos.ts            # Memo functions
├── lib/                     # Utility functions
│   ├── auth-client.ts      # Better Auth client
│   ├── auth-server.ts      # Better Auth server
│   └── utils.ts            # Utility functions
└── public/                  # Static assets
```

## Key Features Implementation

### Payroll Computation

The payroll system automatically calculates:

- Basic pay based on salary type (monthly, daily, hourly)
- Overtime pay (125% for regular days, 169% for rest days)
- Holiday pay (200% for regular holidays, 130% for special holidays)
- Night differential (10% for 10pm-6am)
- Late and undertime deductions
- Government contributions (SSS, PhilHealth, Pag-IBIG)
- Withholding tax (TRAIN Law 2024 brackets)

### Philippine Compliance

- Pre-loaded Philippine holidays for 2025-2030
- SSS contribution table (2024 rates)
- PhilHealth contribution (3% shared 50/50)
- Pag-IBIG contribution (2% each, max 100)
- BIR withholding tax tables (TRAIN Law)

### Role-Based Access Control

- **Admin**: Full system access, organization owner
- **HR Manager**: Access to all HR features, payroll, recruitment
- **Employee**: View own records, submit leave requests, view payslips

## Development

### Adding New Features

1. Update the Convex schema in `convex/schema.ts` if new tables are needed
2. Create Convex functions in the appropriate file in `convex/`
3. Create the UI page in `app/`
4. Add navigation link in `components/layout/sidebar.tsx` if needed

### Database Schema

All database schemas are defined in `convex/schema.ts`. The schema includes:

- Organizations
- Users
- Employees
- Attendance
- Holidays
- Payroll Runs
- Payslips
- Leave Requests
- Leave Types
- Jobs
- Applicants
- Memos
- Settings

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import the project in Vercel
3. Add environment variables:
   - `NEXT_PUBLIC_CONVEX_URL`
   - `SITE_URL`
4. Deploy

### Deploy Convex

Convex automatically deploys when you run `npx convex deploy` or through the Convex dashboard.

## Notes

- The payroll computation uses 2024 Philippine tax and contribution rates
- Update tax tables and contribution rates as needed for compliance
- File uploads use Convex file storage
- All sensitive data should be encrypted in production

## License

[Your License Here]

## Support

For issues and questions, please open an issue in the repository.
