Now let's think about the web application. We want an application in which the user can:
- upload several abi files with SSR profiles
- select one channel/dye to visualize
- select one channel/dye as the standard
- visualize the electropherograms, one per widgets.
- adjust the y-axis of in the widget to be able to see more or less intense peaks in each sample
- adjust the x-axis position to be able to manually align the standards in order to be able to compare the samples.

How do you think that we should create such an application. Which Ts and web technologies should we use? We will keep adding features to the application in the future. The code should be clear, we want to follow standard- and best-practices and not to depend in too many obscure Ts packages and libraries, tend to follow common approaches highly valued in the community.