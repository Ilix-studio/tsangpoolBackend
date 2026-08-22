/**
 * Generates a random secure password.
 * Guarantees at least one uppercase, one lowercase, one digit, one special char.
 * Length: 10 characters.
 */
export const generateRandomPassword = (): string => {
  const uppercaseChars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercaseChars = "abcdefghijkmnopqrstuvwxyz";
  const numberChars = "23456789";
  const specialChars = "!@#$%^&*()_+";

  const allChars = uppercaseChars + lowercaseChars + numberChars + specialChars;

  let password = "";
  password += uppercaseChars[Math.floor(Math.random() * uppercaseChars.length)];
  password += lowercaseChars[Math.floor(Math.random() * lowercaseChars.length)];
  password += numberChars[Math.floor(Math.random() * numberChars.length)];
  password += specialChars[Math.floor(Math.random() * specialChars.length)];

  for (let i = 0; i < 6; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Fisher-Yates shuffle
  const arr = password.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.join("");
};
