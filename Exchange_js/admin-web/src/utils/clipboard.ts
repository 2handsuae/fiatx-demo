export const copyToClipboard = (text: string, id?: string) => {
  navigator.clipboard.writeText(text).then(() => {
    if (id) {
        // You could trigger some global state or just let the caller handle the UI change
        // Since the current code uses a local 'copied' state, we just return true or something
    }
  }).catch(err => {
    console.error('Failed to copy: ', err);
  });
};
