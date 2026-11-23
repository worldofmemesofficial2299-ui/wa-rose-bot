export const defaultConfig = {
  toggles: {
    antilink: true,
    antForward: true,
    antinsfw: true,
    antispam: true,
    welcome: true,
    goodbye: true,
    warnSystem: true,
  },
  rules: [
    "No links",
    "No forwarded messages",
    "Respect everyone",
    "No NSFW content",
    "No bad words"
  ],
  // --- ADD YOUR BAD WORDS HERE ---
  badWords: ["fuck", "shit", "bitch", "asshole", "bastard", "dick", "pussy"], 
  
  warnLimit: 4, // <--- SET TO 4 WARNINGS
  
  welcomeMessage: `*Welcome* {tag} 🤝❤️
We are happy you joined us. Please introduce yourself and make yourself at home.
Please remember: No links, no forwarded messages, and respect everyone. Let us have fun!`,
  
  goodbyeMessage: `*Goodbye* {tag} 💔
Thank you for being part of our group. We will miss you.
You are always welcome to come back anytime. Take care and all the best!`,
  
  nsfwThreshold: 0.7,
};
