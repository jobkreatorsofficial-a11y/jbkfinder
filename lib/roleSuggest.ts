// Curated, portal-friendly recruiting keywords for the Job Title autocomplete.
// These are the search terms that actually return the right cohorts on Shine /
// Foundit / Apna (e.g. "counsellor" and "inside sales" for edtech-sales roles).
// The dashboard blends these with the real titles already sourced into Supabase,
// so suggestions reflect both domain knowledge and observed portal vocabulary —
// without scraping the portals' undocumented suggester APIs.

export const ROLE_KEYWORDS: string[] = [
  // Counselling / EdTech
  "Academic Counsellor",
  "Admission Counsellor",
  "Education Counsellor",
  "Career Counsellor",
  "Student Counsellor",
  "Academic Advisor",
  "Admission Advisor",
  "Learning Consultant",
  "Academic Consultant",
  "Enrollment Advisor",
  "Admission Officer",
  "Academic Coordinator",
  "Counsellor",
  // Sales / Business Development
  "Inside Sales",
  "Inside Sales Executive",
  "Business Development Executive",
  "Business Development Manager",
  "Sales Executive",
  "Field Sales Executive",
  "Telesales Executive",
  "Telecaller",
  "Telecalling Executive",
  "Relationship Manager",
  "Sales Officer",
  "Area Sales Manager",
  "Key Account Manager",
  "Pre Sales Executive",
  // Customer / Operations
  "Customer Support Executive",
  "Customer Service Executive",
  "Operations Executive",
  "Back Office Executive",
  "Process Associate",
  "Team Leader",
  // Technology
  "Software Developer",
  "Frontend Developer",
  "Backend Developer",
  "Full Stack Developer",
  "React Developer",
  "Node.js Developer",
  "Java Developer",
  "Python Developer",
  "Software Engineer",
  "QA Engineer",
  "Data Analyst",
  "Data Scientist",
  "DevOps Engineer",
  // Finance
  "Accountant",
  "Accounts Executive",
  "Financial Analyst",
  "Credit Manager",
  "Loan Officer",
  "Underwriter",
  // HR / Admin
  "HR Executive",
  "HR Recruiter",
  "Talent Acquisition Specialist",
  "Recruiter",
  "Admin Executive",
  // Healthcare
  "Staff Nurse",
  "Pharmacist",
  "Physiotherapist",
  "Medical Representative",
  "Health Advisor",
  // Teaching
  "Teacher",
  "Tutor",
  "Corporate Trainer",
  "Subject Matter Expert",
  // Marketing
  "Digital Marketing Executive",
  "Marketing Executive",
  "SEO Executive",
  "Content Writer",
  "Social Media Executive",
  "Performance Marketing Executive",
];

export interface RoleSuggestion {
  label: string;
  // "role" = curated vocabulary; "sourced" = a title seen in our own candidate data.
  source: "role" | "sourced";
}

// Rank matches: exact prefix first, then word-boundary, then substring.
export function suggestRoles(query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts: string[] = [];
  const word: string[] = [];
  const contains: string[] = [];
  for (const role of ROLE_KEYWORDS) {
    const lower = role.toLowerCase();
    if (lower.startsWith(q)) starts.push(role);
    else if (lower.includes(` ${q}`)) word.push(role);
    else if (lower.includes(q)) contains.push(role);
    if (starts.length >= limit) break;
  }
  return [...starts, ...word, ...contains].slice(0, limit);
}
