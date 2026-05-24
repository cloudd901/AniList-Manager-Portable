# TODO

## Settings Menu

## Card preview update

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

## List Loading issue

## UI layout upgrade

## Export

