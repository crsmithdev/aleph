// construct-eval: user profile stub
// Deliberately has style issues for quality.sh to fix

export interface UserProfile {
  id:string,
  displayName:string,
  createdAt:Date,
  timezone:string
}

export function formatName(profile:UserProfile):string{
  return profile.displayName.trim()
}

export const DEFAULT_TIMEZONE="UTC"
