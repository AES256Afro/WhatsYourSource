/**
 * The question the user is asking, in the words put to the model and to Google AI Mode. Its own
 * module so the popup and background can import it without the rest of the prompt text.
 */
export const QUESTION = 'Is this true, and where can I find the source of this topic?';
/** The same question, shaped for the other kinds of input. */
export const IMAGE_QUESTION = 'Is this image real, and where can I find its original source?';
export const PAGE_QUESTION = 'Is what this page says true, and where can I find the source of this topic?';
export const POST_QUESTION = 'Is this post true, and where can I find the source of what it claims?';
