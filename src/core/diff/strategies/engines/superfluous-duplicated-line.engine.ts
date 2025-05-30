import { SearchReplaceContext } from "../multi-search-replace"

export class SuperfluousDuplicatedLineEngine {
	public static process(originalContent: string, context: SearchReplaceContext): SearchReplaceContext {
		const { startLine, searchContent, replaceContent } = context

		// Early detection of superfluous duplicated line pattern
		// Check if replace content has more lines than search content
		const searchLines = searchContent.split(/\r?\n/)
		const replaceLines = replaceContent.split(/\r?\n/)
		const originalLines = originalContent.split(/\r?\n/)

		if (searchLines.length > 0 && replaceLines.length > searchLines.length && startLine > 0) {
			// Check if the first part of replace content is similar to search content
			const firstPartOfReplace = replaceLines.slice(0, searchLines.length).join("\n")

			// Simple similarity check (we can make this more sophisticated later)
			const isFirstPartSimilar = firstPartOfReplace === searchContent

			if (isFirstPartSimilar && replaceLines.length > searchLines.length) {
				// Get the line that comes after the search block in replace content
				const lineAfterSearchInReplace = replaceLines[searchLines.length]

				// Get the line that comes after the search block in original content
				const lineIndexInOriginal = startLine - 1 + searchLines.length
				if (lineIndexInOriginal < originalLines.length) {
					const lineAfterSearchInOriginal = originalLines[lineIndexInOriginal]

					// If they match, it's likely a superfluous duplicated line scenario
					// We can modify the search content to include the extra line
					if (lineAfterSearchInReplace.trim() === lineAfterSearchInOriginal.trim()) {
						const modifiedSearchContent = searchContent + "\n" + lineAfterSearchInOriginal
						return {
							startLine,
							searchContent: modifiedSearchContent,
							replaceContent,
						}
					}
				}
			}
		}

		// No modification needed, return as-is
		return context
	}
}
