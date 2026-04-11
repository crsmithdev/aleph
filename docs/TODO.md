# Observability

- handling of subagents in sessions
- learning / feedback loop
- easy eval system
- hook audit
- tests audit / rebuild
- docs audi / rebuild / optimization / codebase skill
- agents / subagents page?
- minor session fixes / search

# Research

# Document view
- Getting better, but still feels like a list.  
- The document needs some structure / direction / narrative.  Compare our document on consciousness vs the wikipedia article on the subject (https://en.wikipedia.org/wiki/Consciousness):  the article has a flow from start to finish, a kind of narrative direction, that starts with the general idea, drops back into fundamental concepts, etymology, then does a whole walk forward through history, brings in modern concepts, alternative perspectives, etc.  So ours needs to be structured in some way, it will probably vary per topic, that makes it feel like that.  That probably will require more LLM calls.
- One thing in particular in both document and live views is that the questions look very unnatural as headers for sections, given how extremely long they are.  Also, it's unlikely in any document that the questions asked in the process of making it would be the names of sections, the wikipedia article has very short phrases, usually 1-5 words, that are conceptual rather than direct representations of the question.
- The threads sidebar should be repurposed:  in threads view it's an outline for something that's right next to it, the question names are too long to work in an outline, and the document view doesn't benefit from them at all.
- There are also queries made about a topic, not directly as a question.  We should probably aim for those kind of queries to have 'follow-up questions' that are presented at least as topics themselves.  e.g. "topic A -> topic B" instead of "topic A -> long text of a question about topic B

# Providers page
- The panels should show only what's relevant to selected provider, e.g. if I have OpenRouter active, I only see the OpenRouter key view / input.     
- represent the full API key in the UI, just use '*' in place of most of the digits, instead of striking out a few and hiding the rest.'
- Readability should not even have a green checkmark at all, nor Duck Duck Go
- Restore the 'gap size' option , along the gap analysis checkbox
- Remove the defaults section.

# Queries page
- This shouldn't be a page of its own, this is just what you see when clicking 'research' and should not be in the sidebar at all.
- The settings that pop up when a new question is being added should include gap analysis enabled / size controls.  
- Model default is DeepSeek V3.  When a full model name is entered into the text box, is it possible to query for cost?  Or have some representation of it at the point of submitting a question.
- More follow-up questions than specified are being generated, e.g. default is 8, actual is nearly 2x it seems.  Lower the default to 5, ensure only that many are generated




























