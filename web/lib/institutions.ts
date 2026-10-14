import { institutionKey } from '@/lib/institution';

/**
 * Major Indian research institutions with their official names and common short forms, for the
 * profile's institution picker. Not a complete list (India has 1,100+ universities and 40,000+
 * colleges): names other users already entered are suggested too, and any name can be typed.
 */
export interface KnownInstitution {
  name: string;
  aliases: string[];
}

const iit = (city: string, extra: string[] = []): KnownInstitution => ({
  name: `Indian Institute of Technology ${city}`,
  aliases: [`IIT ${city}`, ...extra]
});
const iiser = (city: string): KnownInstitution => ({
  name: `Indian Institute of Science Education and Research ${city}`,
  aliases: [`IISER ${city}`]
});

export const KNOWN_INSTITUTIONS: KnownInstitution[] = [
  { name: 'Indian Institute of Science', aliases: ['IISc', 'IISc Bangalore', 'IISc Bengaluru'] },
  iit('Bombay', ['IITB']),
  iit('Delhi', ['IITD']),
  iit('Madras', ['IITM']),
  iit('Kanpur', ['IITK']),
  iit('Kharagpur', ['IIT KGP']),
  iit('Roorkee'),
  iit('Guwahati'),
  iit('Hyderabad'),
  iit('Indore'),
  { name: 'Indian Institute of Technology (BHU) Varanasi', aliases: ['IIT BHU', 'IIT Varanasi'] },
  { name: 'Indian Institute of Technology (ISM) Dhanbad', aliases: ['IIT ISM', 'IIT Dhanbad', 'ISM Dhanbad'] },
  iit('Ropar'),
  iit('Mandi'),
  iit('Gandhinagar'),
  iit('Jodhpur'),
  iit('Patna'),
  iit('Bhubaneswar'),
  iit('Tirupati'),
  iit('Palakkad'),
  iit('Jammu'),
  iit('Dharwad'),
  iit('Bhilai'),
  iit('Goa'),
  iiser('Pune'),
  iiser('Kolkata'),
  iiser('Mohali'),
  iiser('Bhopal'),
  iiser('Thiruvananthapuram'),
  iiser('Tirupati'),
  iiser('Berhampur'),
  { name: 'National Institute of Technology Tiruchirappalli', aliases: ['NIT Trichy', 'NIT Tiruchirappalli'] },
  { name: 'National Institute of Technology Karnataka, Surathkal', aliases: ['NITK', 'NIT Surathkal'] },
  { name: 'National Institute of Technology Warangal', aliases: ['NIT Warangal'] },
  { name: 'National Institute of Technology Calicut', aliases: ['NIT Calicut'] },
  { name: 'National Institute of Technology Rourkela', aliases: ['NIT Rourkela'] },
  { name: 'International Institute of Information Technology, Hyderabad', aliases: ['IIIT Hyderabad', 'IIITH'] },
  { name: 'Indraprastha Institute of Information Technology Delhi', aliases: ['IIIT Delhi', 'IIITD'] },
  { name: 'International Institute of Information Technology Bangalore', aliases: ['IIIT Bangalore', 'IIITB'] },
  { name: 'University of Delhi', aliases: ['Delhi University', 'DU'] },
  { name: 'Jawaharlal Nehru University', aliases: ['JNU'] },
  { name: 'Banaras Hindu University', aliases: ['BHU'] },
  { name: 'University of Hyderabad', aliases: ['UoH', 'Hyderabad Central University', 'HCU'] },
  { name: 'Aligarh Muslim University', aliases: ['AMU'] },
  { name: 'Jamia Millia Islamia', aliases: ['JMI', 'Jamia'] },
  { name: 'Pondicherry University', aliases: [] },
  { name: 'Visva-Bharati', aliases: ['Visva Bharati', 'Santiniketan'] },
  { name: 'Savitribai Phule Pune University', aliases: ['SPPU', 'Pune University', 'University of Pune'] },
  { name: 'University of Mumbai', aliases: ['Mumbai University'] },
  { name: 'Anna University', aliases: [] },
  { name: 'Jadavpur University', aliases: ['JU'] },
  { name: 'University of Calcutta', aliases: ['Calcutta University'] },
  { name: 'Osmania University', aliases: [] },
  { name: 'Panjab University', aliases: ['Punjab University Chandigarh'] },
  { name: 'Andhra University', aliases: [] },
  { name: 'Bangalore University', aliases: [] },
  { name: 'University of Madras', aliases: ['Madras University'] },
  { name: 'Gujarat University', aliases: [] },
  { name: 'University of Rajasthan', aliases: ['Rajasthan University'] },
  { name: 'Gauhati University', aliases: [] },
  { name: 'Utkal University', aliases: [] },
  { name: 'University of Kerala', aliases: ['Kerala University'] },
  { name: 'Cochin University of Science and Technology', aliases: ['CUSAT'] },
  { name: 'COEP Technological University', aliases: ['COEP', 'College of Engineering Pune'] },
  { name: 'Birla Institute of Technology and Science, Pilani', aliases: ['BITS Pilani', 'BITS'] },
  { name: 'Vellore Institute of Technology', aliases: ['VIT', 'VIT Vellore'] },
  { name: 'Manipal Academy of Higher Education', aliases: ['MAHE', 'Manipal University'] },
  { name: 'Amrita Vishwa Vidyapeetham', aliases: ['Amrita University'] },
  { name: 'Thapar Institute of Engineering and Technology', aliases: ['Thapar University'] },
  { name: 'SRM Institute of Science and Technology', aliases: ['SRM University', 'SRMIST'] },
  { name: 'Tata Institute of Fundamental Research', aliases: ['TIFR'] },
  { name: 'National Centre for Biological Sciences', aliases: ['NCBS'] },
  { name: 'CSIR-National Chemical Laboratory', aliases: ['NCL Pune', 'CSIR NCL'] },
  { name: 'CSIR-Centre for Cellular and Molecular Biology', aliases: ['CCMB', 'CSIR CCMB'] },
  { name: 'Raman Research Institute', aliases: ['RRI'] },
  { name: 'Bose Institute', aliases: [] },
  { name: 'Indian Association for the Cultivation of Science', aliases: ['IACS'] },
  { name: 'All India Institute of Medical Sciences, New Delhi', aliases: ['AIIMS Delhi', 'AIIMS'] },
  { name: 'Postgraduate Institute of Medical Education and Research, Chandigarh', aliases: ['PGIMER'] }
];

/** Known institutions whose name or a short form contains the query (case-insensitive). */
export function matchKnownInstitutions(query: string, limit = 8): string[] {
  const q = institutionKey(query);
  if (q.length < 2) return [];
  return KNOWN_INSTITUTIONS.filter((i) => [i.name, ...i.aliases].some((n) => institutionKey(n).includes(q)))
    .slice(0, limit)
    .map((i) => i.name);
}

/** Merge names already used on the radar (most used first) with known ones, without duplicates. */
export function mergeSuggestions(used: string[], known: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...used, ...known]) {
    const key = institutionKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
    if (out.length >= limit) break;
  }
  return out;
}

/** The official name when `name` is exactly a known institution or one of its short forms; else `name`
 * trimmed. Applied on save so "IIT Bombay" and "Indian Institute of Technology Bombay" match. */
export function canonicalInstitution(name: string): string {
  const key = institutionKey(name);
  const known = KNOWN_INSTITUTIONS.find((i) => [i.name, ...i.aliases].some((n) => institutionKey(n) === key));
  return known ? known.name : name.trim();
}
