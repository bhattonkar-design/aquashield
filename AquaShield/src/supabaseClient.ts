import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aqkivwbsrmymogiilpyw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxa2l2d2Jzcm15bW9naWlscHl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0NzEzMDcsImV4cCI6MjA0MTA0NzMwN30.85sF6N4F6VdZl9-X6gR0qGqT-R1M3P-y0kYQf1d3X0M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);