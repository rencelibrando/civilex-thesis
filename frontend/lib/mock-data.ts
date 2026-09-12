export const caseHistory = [
  { id: "1", query: "What are the requisites for a valid contract of sale?", date: "2026-09-12", status: "Resolved", type: "Inquiry" },
  { id: "2", query: "Outline the grounds for legal separation under the Family Code.", date: "2026-09-10", status: "Resolved", type: "Research" },
  { id: "3", query: "Draft a demand letter for unpaid rent.", date: "2026-09-08", status: "Draft", type: "Drafting" },
  { id: "4", query: "Analyze retroactivity of Republic Act No. 11642.", date: "2026-09-05", status: "Resolved", type: "Analysis" },
];

export const recentActivity = [
  { id: "1", action: "Generated a legal opinion on property dispute", time: "2 hours ago" },
  { id: "2", action: "Reviewed document 'Lease_Agreement_v2.pdf'", time: "5 hours ago" },
  { id: "3", action: "Saved case history #1042: Nullity of Marriage", time: "1 day ago" },
];

export const civilCodeTree = [
  {
    id: "book-1",
    title: "Book I: Persons",
    children: [
      {
        id: "title-1",
        title: "Title I: Civil Personality",
        children: [
          { id: "chapter-1", title: "Chapter 1: General Provisions" },
          { id: "chapter-2", title: "Chapter 2: Natural Persons" },
          { id: "chapter-3", title: "Chapter 3: Juridical Persons" }
        ]
      },
      {
        id: "title-2",
        title: "Title II: Citizenship and Domicile",
        children: []
      }
    ]
  },
  {
    id: "book-2",
    title: "Book II: Property, Ownership, and its Modifications",
    children: []
  },
  {
    id: "book-3",
    title: "Book III: Different Modes of Acquiring Ownership",
    children: []
  },
  {
    id: "book-4",
    title: "Book IV: Obligations and Contracts",
    children: [
      {
        id: "title-1",
        title: "Title I: Obligations",
        children: [
          { id: "chapter-1", title: "Chapter 1: General Provisions" },
          { id: "chapter-2", title: "Chapter 2: Nature and Effect of Obligations" },
        ]
      }
    ]
  }
];

export const chatPrompts = [
  "Outline requirements for annulment",
  "Draft a demand letter",
  "Explain Article 1159 of the Civil Code",
  "What is the prescriptive period for filing a labor case?",
];

export const userProfile = {
  name: "Atty. Juan Dela Cruz",
  email: "juan.delacruz@lawfirm.com",
  role: "Senior Partner",
  avatar: "https://i.pravatar.cc/150?u=juan",
};
