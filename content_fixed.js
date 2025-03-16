// Initialize variables
let previousPageContent = "";
let movieNameToFind = "";
let formatPreferenceToFind = "ANY"; // Default to any format
let isFirstCheck = true;
let isMonitoring = false; // Track if monitoring is active
let formatTypesToFind = ["2d", "3d", "imax", "4dx", "ua", "u/a", "a"]; // Common format types to look for
let periodicCheckInterval = null; // Store interval ID for clearing
let countdownInterval = null; // Store countdown interval ID
let nextRefreshIn = 180; // Default refresh interval in seconds (will be updated from storage)

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request.action);

  if (request.action === "stopMonitoring") {
    console.log("Content script received stop monitoring message");
    stopAllMonitoring();
    sendResponse({ success: true });
  } else if (request.action === "checkMonitoring") {
    // If we receive a check monitoring message, verify our state
    chrome.storage.local.get(
      ["movieName", "formatPreference", "isMonitoring", "refreshInterval"],
      (result) => {
        if (result.isMonitoring && result.movieName) {
          // Ensure we're still monitoring with the correct settings
          console.log("Restoring monitoring state after refresh");
          movieNameToFind = result.movieName;
          formatPreferenceToFind = result.formatPreference || "ANY";
          isMonitoring = true;
          if (result.refreshInterval) {
            nextRefreshIn = result.refreshInterval * 60;
          }

          // Clear any existing intervals to prevent duplicates
          if (periodicCheckInterval) {
            clearInterval(periodicCheckInterval);
            periodicCheckInterval = null;
          }

          // Restart the periodic checks
          startPeriodicChecks();

          // Do an immediate check
          checkForMovie();
        } else {
          console.log("Monitoring is not active in storage");
        }
      }
    );
    sendResponse({ success: true, isMonitoring: isMonitoring });
  } else if (request.action === "checkMovie") {
    // Force an immediate check for the movie
    console.log("Received request to check for movie immediately");
    // Force the check even if content hasn't changed
    isFirstCheck = true; // This will force the check to run
    checkForMovie();
    sendResponse({ success: true, checked: true });
  } else if (request.action === "ping") {
    // Simple ping to check if content script is running
    console.log("Received ping from background script");
    sendResponse({
      success: true,
      message: "Content script is running",
      isMonitoring: isMonitoring,
    });
  } else {
    // If we receive any other message, check for the movie
    checkForMovie();
  }
  return true; // Keep the message channel open for asynchronous response
});

// When the content script loads, get the movie name from storage
chrome.storage.local.get(
  ["movieName", "formatPreference", "isMonitoring", "refreshInterval"],
  (result) => {
    console.log("Content script loaded, checking storage:", result);

    if (result.isMonitoring && result.movieName) {
      movieNameToFind = result.movieName;
      formatPreferenceToFind = result.formatPreference || "ANY";
      isMonitoring = true;
      // Convert minutes to seconds for the countdown
      if (result.refreshInterval) {
        nextRefreshIn = result.refreshInterval * 60;
      }
      console.log(
        "Content script is searching for:",
        movieNameToFind,
        "with format:",
        formatPreferenceToFind,
        "refresh interval:",
        nextRefreshIn,
        "seconds"
      );

      // Check if movie was previously found (after a refresh)
      if (localStorage.getItem("bms_movie_found") === "true") {
        const storedMovieName = localStorage.getItem("bms_movie_name");
        const storedFormatInfo = localStorage.getItem("bms_format_info");

        console.log(
          "Movie was previously found, restoring focus after refresh",
          {
            movieName: storedMovieName,
            formatInfo: storedFormatInfo,
          }
        );

        // Force tab focus after page reload if movie was found
        chrome.runtime.sendMessage({
          action: "forceTabFocus",
          data: {
            url: window.location.href,
            movieName: storedMovieName || movieNameToFind,
            formatInfo: storedFormatInfo || formatPreferenceToFind,
          },
        });
      }

      // Do an initial check after a short delay to ensure page is loaded
      setTimeout(() => {
        checkForMovie();
        // Start periodic monitoring
        startPeriodicChecks();
      }, 2000);
    }
  }
);

// Function to check for movie name
function checkForMovie() {
  console.log("Running checkForMovie()");
  // Skip if monitoring has been stopped
  if (!isMonitoring) {
    console.log("Monitoring is stopped, skipping check");
    return;
  }

  // Make sure we have a movie name to find
  if (!movieNameToFind) {
    // Try to get it from storage again
    chrome.storage.local.get(
      ["movieName", "isMonitoring", "refreshInterval"],
      (result) => {
        if (result.movieName && result.isMonitoring) {
          movieNameToFind = result.movieName;
          isMonitoring = true;
          if (result.refreshInterval) {
            nextRefreshIn = result.refreshInterval * 60;
          }
          console.log("Retrieved movieName from storage:", movieNameToFind);

          // Now perform the check with the retrieved movie name
          performCheck();

          // Make sure the timer is running
          if (!countdownInterval) {
            createCountdownTimer();
          }
        } else {
          console.log(
            "No movie name found in storage or monitoring is stopped"
          );
        }
      }
    );
  } else {
    performCheck();
  }

  // Notify that check was performed
  chrome.runtime.sendMessage({
    action: "checkPerformed",
    timestamp: new Date().toISOString(),
  });
}

// Function to create or update countdown timer
function createCountdownTimer() {
  // Make sure nextRefreshIn is valid
  if (!nextRefreshIn || nextRefreshIn <= 0) {
    // Default to 3 minutes (180 seconds) if invalid
    console.warn(
      "Invalid nextRefreshIn value:",
      nextRefreshIn,
      "using default of 180s"
    );
    nextRefreshIn = 180;

    // Try to get it from storage
    chrome.storage.local.get(["refreshInterval"], (result) => {
      if (result.refreshInterval) {
        const interval = parseFloat(result.refreshInterval);
        if (!isNaN(interval) && interval > 0) {
          nextRefreshIn = interval * 60;
          console.log(
            "Retrieved refresh interval from storage:",
            nextRefreshIn,
            "seconds"
          );
        }
      }
    });
  }

  // Remove existing timer if present
  const existingTimer = document.getElementById("bms-countdown-timer");
  if (existingTimer) {
    existingTimer.remove();
  }

  // Create new timer element
  const timer = document.createElement("div");
  timer.id = "bms-countdown-timer";
  timer.style.cssText = `
    position: fixed;
    left: 20px;
    top: 20px;
    background-color: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: bold;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    font-size: 16px;
    pointer-events: none;
    font-family: Arial, sans-serif;
    border: 2px solid #ff9800;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
    transform: translateZ(0);
    will-change: transform;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  `;
  document.body.appendChild(timer);

  // Update countdown
  let timeLeft = nextRefreshIn;

  // Clear existing countdown interval if any
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  // Start new countdown
  function updateTimer() {
    if (isMonitoring) {
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      timer.innerHTML = `
        <div style="margin-bottom: 4px; color: #ff9800;">BookMyShow Monitor</div>
        Next refresh in:
        <span style="color: #4caf50; font-size: 18px;">
          ${minutes}m ${seconds.toString().padStart(2, "0")}s
        </span>
        <div style="font-size: 12px; margin-top: 4px; color: #ccc;">
          Monitoring: ${movieNameToFind}
          ${
            formatPreferenceToFind !== "ANY"
              ? ` (${formatPreferenceToFind})`
              : ""
          }
        </div>
      `;
      timeLeft--;
      if (timeLeft < 0) {
        timeLeft = nextRefreshIn;
      }
    } else {
      timer.innerHTML = `
        <div style="margin-bottom: 4px; color: #ff9800;">BookMyShow Monitor</div>
        <span style="color: #f44336;">Monitoring stopped</span>
      `;
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
    }
  }

  updateTimer(); // Initial update
  countdownInterval = setInterval(updateTimer, 1000);

  // Ensure timer is always on top and visible
  function ensureTimerVisibility() {
    if (timer && timer.style) {
      timer.style.zIndex = "2147483647";
    }
  }

  // Check timer visibility periodically
  setInterval(ensureTimerVisibility, 1000);

  // Also ensure visibility when page changes
  document.addEventListener("scroll", ensureTimerVisibility);
  document.addEventListener("resize", ensureTimerVisibility);
}

// Start periodic checks for changes
function startPeriodicChecks() {
  console.log(
    "Starting periodic checks with interval:",
    nextRefreshIn,
    "seconds"
  );

  // Clear any existing intervals first
  if (periodicCheckInterval) {
    clearInterval(periodicCheckInterval);
    periodicCheckInterval = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // Set up a new interval for checking
  periodicCheckInterval = setInterval(() => {
    if (isMonitoring) {
      console.log("Performing periodic check");
      checkForMovie();
    } else {
      // If monitoring has stopped, clear the intervals
      clearInterval(periodicCheckInterval);
      periodicCheckInterval = null;
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }
  }, 30000); // Check every 30 seconds inside the page, regardless of refresh interval

  // Create countdown timer
  createCountdownTimer();

  // Log the monitoring state to verify
  console.log("Monitoring activated: ", {
    isMonitoring: isMonitoring,
    movieName: movieNameToFind,
    format: formatPreferenceToFind,
    refreshInterval: nextRefreshIn,
  });
}

// Stop all monitoring activities
function stopAllMonitoring() {
  console.log("Stopping all monitoring activities in content script");
  isMonitoring = false;

  // Clear the periodic check interval
  if (periodicCheckInterval) {
    clearInterval(periodicCheckInterval);
    periodicCheckInterval = null;
  }

  // Clear the countdown interval
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // Update countdown timer to show stopped status
  const timer = document.getElementById("bms-countdown-timer");
  if (timer) {
    timer.textContent = "Monitoring stopped";
  }

  // Clear any other monitoring resources
  movieNameToFind = "";
  formatPreferenceToFind = "ANY";

  // Update the local storage as well (belt and suspenders)
  chrome.storage.local.set({ isMonitoring: false }, function () {
    console.log("Content script confirmed monitoring is stopped");
  });
}

// Perform the actual check for the movie name
function performCheck() {
  // Don't proceed if monitoring has been stopped
  if (!isMonitoring) return;

  // Get the entire page content
  const pageContent = document.body.innerText;

  // Skip if the content hasn't changed since the last check and it's not the first check
  if (!isFirstCheck && pageContent === previousPageContent) {
    console.log("Page content unchanged, skipping check");
    return;
  }

  // Update saved content
  previousPageContent = pageContent;
  isFirstCheck = false;

  console.log(
    `Checking page for: "${movieNameToFind}" with format: ${formatPreferenceToFind}`
  );

  // Check if the movie name appears in the page content
  if (pageContent.toLowerCase().includes(movieNameToFind.toLowerCase())) {
    console.log(`Movie "${movieNameToFind}" found on page!`);

    // Find and highlight the movie elements
    const result = findMovieAndFormatElements();

    if (
      result.foundElements.length > 0 &&
      (formatPreferenceToFind === "ANY" || result.foundFormat)
    ) {
      console.log("MOVIE FOUND! Focusing tab and sending notification...");

      // Set a flag in localStorage to indicate movie was found
      // This helps with persistence across refreshes
      localStorage.setItem("bms_movie_found", "true");
      localStorage.setItem("bms_movie_name", movieNameToFind);
      localStorage.setItem("bms_format_info", result.formatInfo);

      // Define a function for repeated focus attempts
      let focusAttempts = 0;
      const maxFocusAttempts = 3;

      function attemptTabFocus() {
        // ALWAYS focus the tab when a movie is found, on every check/refresh
        chrome.runtime.sendMessage(
          {
            action: "forceTabFocus",
            data: {
              url: window.location.href,
              movieName: movieNameToFind,
              formatInfo: result.formatInfo,
            },
          },
          (response) => {
            console.log(
              `Tab focus attempt ${
                focusAttempts + 1
              }/${maxFocusAttempts} sent with response:`,
              response
            );

            // Try direct window focus as well
            try {
              window.focus();
            } catch (e) {
              console.error("Could not focus window directly:", e);
            }

            focusAttempts++;
            if (focusAttempts < maxFocusAttempts) {
              // Try again after a delay
              setTimeout(attemptTabFocus, 2000);
            }
          }
        );
      }

      // Start the focus attempts
      attemptTabFocus();

      // Scroll to the first found element - with a slight delay to ensure DOM is ready
      if (result.foundElements[0]) {
        console.log(
          "Found element to scroll to:",
          result.foundElements[0].innerText.trim()
        );
        // Use setTimeout to ensure DOM is ready for scrolling
        setTimeout(() => {
          scrollToElement(result.foundElements[0]);
        }, 300);
      }

      // Notify the background script only if elements were actually found and highlighted
      // and the format preference was also found (or any format is acceptable)
      chrome.runtime.sendMessage({
        action: "movieFound",
        data: {
          movieName: movieNameToFind,
          formatInfo: result.formatInfo,
          url: window.location.href,
        },
      });
    }
  } else {
    console.log(`Movie "${movieNameToFind}" not found on this page.`);
  }
}

// Function to find elements containing movie information and highlight them
function findMovieAndFormatElements() {
  // Create an array of search terms from the movie name (split by spaces)
  const searchTerms = movieNameToFind.toLowerCase().split(/\s+/);

  // Define global format patterns for ANY preference at the beginning of the function
  const defaultFormatPatterns =
    formatPreferenceToFind === "ANY"
      ? ["2d", "3d", "imax", "4dx", "dolby", "atmos"]
      : [formatPreferenceToFind.toLowerCase()];

  // First, try to find movie elements with the specific BookMyShow structure
  const movieListings = document.querySelectorAll(
    "li.sc-1412vr2-0, div.sc-1412vr2-1, div.movie-card"
  );
  let foundElements = [];
  let foundFormat = false;
  let formatInfo = "";

  console.log(
    `Looking for movie "${movieNameToFind}" with format "${formatPreferenceToFind}"`
  );

  // Check each movie listing element
  movieListings.forEach((listing) => {
    const listingText = listing.innerText.toLowerCase();

    // Skip if this listing doesn't contain our movie name
    if (!listingText.includes(movieNameToFind.toLowerCase())) {
      return;
    }

    console.log("Found potential movie listing:", listingText);

    // Now check if this listing has our required format (if specified)
    let hasRequiredFormat = formatPreferenceToFind === "ANY";

    if (!hasRequiredFormat) {
      // Define format patterns to check
      let currentFormatPatterns = [];
      const format = formatPreferenceToFind.toLowerCase();

      // Add format variations
      if (format === "2d") currentFormatPatterns = ["2d"];
      else if (format === "3d") currentFormatPatterns = ["3d"];
      else if (format === "imax") currentFormatPatterns = ["imax"];
      else if (format === "imax 2d")
        currentFormatPatterns = ["imax 2d", "imax.*2d"];
      else if (format === "imax 3d")
        currentFormatPatterns = ["imax 3d", "imax.*3d"];
      else if (format === "4dx") currentFormatPatterns = ["4dx"];
      else if (format === "4dx 2d")
        currentFormatPatterns = ["4dx 2d", "4dx.*2d"];
      else if (format === "4dx 3d")
        currentFormatPatterns = ["4dx 3d", "4dx.*3d"];
      else currentFormatPatterns = [format];

      // Check if listing contains any of our format patterns
      for (const pattern of currentFormatPatterns) {
        const regex = new RegExp(`\\b${pattern}\\b|${pattern}`, "i");
        if (regex.test(listingText)) {
          hasRequiredFormat = true;
          formatInfo = formatPreferenceToFind;
          foundFormat = true;
          break;
        }
      }
    } else {
      // If any format is acceptable, try to extract the format info
      const formatMatches = listingText.match(
        /\b(2d|3d|imax|4dx|dolby|atmos)\b/gi
      );
      if (formatMatches) {
        formatInfo = formatMatches.join(", ");
        foundFormat = true;
      }
    }

    // Only highlight and add to found elements if both movie and format match
    if (hasRequiredFormat) {
      foundElements.push(listing);

      // Try to find the specific elements for movie name and format
      const movieNameElements = listing.querySelectorAll(
        "a.sc-1412vr2-2, div.sc-1412vr2-4, span.sc-1412vr2-6"
      );

      movieNameElements.forEach((elem) => {
        const elemText = elem.innerText.toLowerCase();
        if (elemText.includes(movieNameToFind.toLowerCase())) {
          // This is likely the movie name element
          highlightElement(elem, "#ffeb3b"); // Yellow for movie name
        } else if (
          defaultFormatPatterns.some((format) =>
            elemText.includes(format.toLowerCase())
          )
        ) {
          // This is likely the format element
          highlightElement(elem, "#a5d6a7"); // Green for format
        }
      });
    }
  });

  // Check all elements for potential movie information
  const allElements = document.querySelectorAll(
    "div, span, a, p, h1, h2, h3, h4, h5, h6"
  );
  allElements.forEach((element) => {
    const elementText = element.innerText;
    if (elementText && elementText.includes(movieNameToFind)) {
      // This might be a movie description
      const elementTextLower = elementText.toLowerCase();
      if (
        // Skip elements we already found
        !foundElements.includes(element) &&
        // Skip navigation elements
        !element.closest("nav") &&
        // Skip if the element doesn't contain format info when required
        (formatPreferenceToFind === "ANY" ||
          defaultFormatPatterns.some((format) =>
            elementTextLower.includes(format.toLowerCase())
          ))
      ) {
        // This is a good match
        foundElements.push(element);
        // Try to determine format
        if (!formatInfo && formatPreferenceToFind === "ANY") {
          const formatMatches = elementTextLower.match(
            /\b(2d|3d|imax|4dx|dolby|atmos)\b/gi
          );
          formatInfo =
            formatPreferenceToFind === "ANY"
              ? "detected format"
              : formatPreferenceToFind;
        }
      }
    }
  });

  return {
    foundElements: foundElements,
    foundFormat: foundFormat || formatPreferenceToFind === "ANY",
    formatInfo: formatInfo || formatPreferenceToFind,
  };
}

// Function to scroll to an element
function scrollToElement(element) {
  console.log("Attempting to scroll to element:", element);

  // Always try to scroll, even if element might be in viewport
  try {
    // Get element position relative to the document
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const elementTop = rect.top + scrollTop;

    console.log("Element position:", {
      top: rect.top,
      elementTop: elementTop,
      windowHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    });

    // First try scrollIntoView
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    console.log("scrollIntoView executed");

    // As a backup, also use window.scrollTo
    setTimeout(() => {
      // Calculate position to center element in viewport
      const offsetPosition = elementTop - window.innerHeight / 2;

      // Scroll to the calculated position
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth",
      });

      console.log("scrollTo executed as backup, position:", offsetPosition);

      // Add stronger visual indicators
      addEnhancedVisualIndicators(element);
    }, 500);
  } catch (error) {
    console.error("Error during scrolling:", error);

    // Last resort fallback - try simple scrolling
    try {
      // Try simpler scroll approach
      const yPosition = element.offsetTop;
      window.scrollTo(0, yPosition - 100); // Scroll to element with some offset
      console.log("Used fallback scrolling to position:", yPosition);

      // Add visual indicators even if scrolling failed
      addEnhancedVisualIndicators(element);
    } catch (e) {
      console.error("All scrolling methods failed:", e);
    }
  }
}

// Enhanced visual indicators to make the element more noticeable
function addEnhancedVisualIndicators(element) {
  // Add pulse effect
  addPulseEffect(element);

  // Add a more visible marker
  addVisibleMarker(element);

  // Briefly flash the element for attention
  flashElement(element);
}

// Function to add a visible marker that points to the element
function addVisibleMarker(element) {
  // Create a marker element
  const marker = document.createElement("div");
  marker.id = "bms-visible-marker";
  marker.style.cssText = `
    position: fixed;
    right: 20px;
    top: 50%;
    background-color: #ff5722;
    color: white;
    padding: 10px 15px;
    border-radius: 5px;
    font-weight: bold;
    z-index: 10000;
    box-shadow: 0 0 10px rgba(0,0,0,0.5);
    font-size: 14px;
    pointer-events: none;
    transform: translateY(-50%);
  `;
  marker.textContent = "→ FOUND HERE ←";

  // Remove any existing marker
  const existingMarker = document.getElementById("bms-visible-marker");
  if (existingMarker) {
    existingMarker.remove();
  }

  // Add marker to the page
  document.body.appendChild(marker);

  // Remove marker after some time
  setTimeout(() => {
    if (marker && marker.parentNode) {
      marker.parentNode.removeChild(marker);
    }
  }, 8000);
}

// Function to flash the element to draw attention
function flashElement(element) {
  // Original background
  const originalBg = element.style.backgroundColor;

  // Flash sequence
  const flashSequence = [
    "#FF5722",
    "#FF9800",
    originalBg,
    "#FF5722",
    "#FF9800",
    originalBg,
  ];

  // Apply flash sequence
  let i = 0;
  const flashInterval = setInterval(() => {
    if (i >= flashSequence.length) {
      clearInterval(flashInterval);
      return;
    }

    element.style.backgroundColor = flashSequence[i];
    i++;
  }, 200); // Flash every 200ms
}

// Function to add a pulse effect to draw attention to the found element
function addPulseEffect(element) {
  // Create and add a CSS class for the pulse animation
  if (!document.getElementById("bms-pulse-style")) {
    const style = document.createElement("style");
    style.id = "bms-pulse-style";
    style.textContent = `
      @keyframes bms-pulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(255, 152, 0, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0); }
      }
      .bms-pulse {
        animation: bms-pulse 2s infinite;
        position: relative;
        z-index: 999;
      }
    `;
    document.head.appendChild(style);
  }

  // Add pulse class
  element.classList.add("bms-pulse");

  // Remove it after a few pulses
  setTimeout(() => {
    element.classList.remove("bms-pulse");
  }, 6000); // Remove after 6 seconds (3 pulses)
}

// Function to highlight an element with a specific color
function highlightElement(element, color) {
  console.log("Highlighting element:", element.innerText.trim());

  // Save original styles
  const originalStyles = {
    backgroundColor: element.style.backgroundColor,
    color: element.style.color,
    fontWeight: element.style.fontWeight,
    border: element.style.border,
    borderRadius: element.style.borderRadius,
    padding: element.style.padding,
    zIndex: element.style.zIndex,
  };

  // Apply highlight styles
  element.style.backgroundColor = color;
  element.style.color = "#000000";
  element.style.fontWeight = "bold";
  element.style.border = "2px solid #ff9800";
  element.style.borderRadius = "4px";
  element.style.padding = element.style.padding || "2px";
  element.style.zIndex = "999"; // Ensure highlighted element is above others

  // Add a small animation
  element.style.transition = "transform 0.3s ease";
  element.style.transform = "scale(1.05)";

  // Reset the transform after a short delay
  setTimeout(() => {
    element.style.transform = "scale(1)";
  }, 300);

  // Return to original style after 10 seconds
  setTimeout(() => {
    Object.keys(originalStyles).forEach((property) => {
      element.style[property] = originalStyles[property];
    });
    element.style.transition = "";
  }, 10000);
}

// Also check when page visibility changes (user returns to the tab)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isMonitoring) {
    checkForMovie();
  }
});

// Also check when DOM content is loaded
document.addEventListener("DOMContentLoaded", () => {
  if (isMonitoring) {
    setTimeout(checkForMovie, 1000); // Wait for page to fully load
  }
});

// Also check when page is scrolled (new content might be loaded)
let scrollTimeout;
document.addEventListener("scroll", () => {
  if (isMonitoring) {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(checkForMovie, 500);
  }
});
