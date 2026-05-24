# TODO

## Settings Menu

## Offline mode feature

- Create an Offline mode feature that makes no outside calls.
    - Give notification (OK or Cancel) that all items will be packaged locally.
    - Save all cached items locally to be recalled using this mode.
        - Items of importance is all basic info on the anime card.
            - Thumbnail, Availibility counts, year, type, rating, progress, score, notes, description, genres.
        - If Availability or rating has not been fetched, then these should be left out of the local cache.
            - Give warning of how many of what type of data is missing. And add note to fetch this information prior to enabling offline mode.
        - All other data not fetched such as images should be fetched at time of enabling offline mode with a notification message and progress.
    - Use locally packaged files as long as the offline mode is active.
    - Turning off this mode should give the notification (Yes or NO) to remove locally saved data.
    - Refresh or calling buttons should be disabled while enabled.

## Issue

- when working on a large list to set scores: I set the list to sort by personal score. (secondary sort should be name). I'm working on adding new scores for shows, but every time I save a score, the scrollbar jumps to wherever the anime re-sorts to.
Ex: I'm at the bottom of the list and I want to set the score on two shows. After setting one show, the window scrolls all the way to wherever the show is resoted to. I then have to scroll back down and find the second show again. I want the scroll focus to stay put instead of moving with the show card.
	- We implemented a fix but it only works intermittently. After setting 2 or 3 scores, it will still jump to follow the resorted card.

- Recheck Episodes still slow to load.
	- Need more transparency to see what's happening.
	- Need finer progress info.

## Upgrades

- Experiment with different alert icons.

- Add synonyms to Add page cards.

- Add 'Complete' filter next to the Incomplete filter.