export const copyToClipboard = (text: string, id?: string) => {
  navigator.clipboard.writeText(text).then(() => {
    // Success
  }).catch(err => {
    console.error('Failed to copy: ', err);
  });
};
