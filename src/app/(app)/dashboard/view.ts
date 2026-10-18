// Which reading of the dashboard's left column someone gets. Its own module
// because page.tsx decides it on the server and the client draws it, and the
// server cannot import from a "use client" file.
//
//   personal  what the section owes you, for everybody who answers for no budget
//   unit      the result units you answer for (an utskottsmästare)
//   section   every result unit (skattmästeriet, or an utskottsmästare looking wider)
export type DashboardView = "personal" | "unit" | "section";
