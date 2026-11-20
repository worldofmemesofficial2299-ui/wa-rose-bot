export const defaultConfig = {
  toggles: {
    antilink: true,
    antForward: true,
    antinsfw: true,      // "sex dictator"
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
  ],
  welcomeMessage: `*Welcome* {tag} 🤝❤️
We are happy you joined us. Please introduce yourself and make yourself at home.
Please remember: No links, no forwarded messages, and respect everyone. Let us have fun!`,
  goodbyeMessage: `*Goodbye* {tag} 💔
Thank you for being part of our group. We will miss you.
You are always welcome to come back anytime. Take care and all the best!`,
  warnLimit: 3,          // auto-kick after 3 warnings
  nsfwThreshold: 0.7,    // Sightengine "adult" score threshold
};
