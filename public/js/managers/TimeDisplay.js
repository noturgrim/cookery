/**
 * Minimal Time Display
 * Shows current game time at the top center of the screen
 */
export class TimeDisplay {
  constructor(dayNightCycle) {
    this.dayNightCycle = dayNightCycle;
    this.container = null;
    this.timeElement = null;
    this.periodElement = null;
    this.createDisplay();
  }

  /**
   * Create the minimal time display
   */
  createDisplay() {
    // Create container
    this.container = document.createElement("div");
    this.container.id = "time-display";
    this.container.style.cssText = `
      position: fixed;
      top: 15px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(10px);
      padding: 8px 16px;
      border-radius: 20px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.15);
      transition: all 0.3s ease;
      cursor: default;
      user-select: none;
    `;

    // Add hover effect
    this.container.addEventListener("mouseenter", () => {
      this.container.style.background = "rgba(0, 0, 0, 0.8)";
      this.container.style.transform = "translateX(-50%) scale(1.05)";
    });
    this.container.addEventListener("mouseleave", () => {
      this.container.style.background = "rgba(0, 0, 0, 0.65)";
      this.container.style.transform = "translateX(-50%) scale(1)";
    });

    // Time icon/emoji
    const iconElement = document.createElement("span");
    iconElement.id = "time-icon";
    iconElement.style.cssText = `
      font-size: 18px;
      line-height: 1;
    `;
    iconElement.textContent = "🕐";

    // Time text
    this.timeElement = document.createElement("span");
    this.timeElement.id = "time-text";
    this.timeElement.style.cssText = `
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: 0.5px;
      min-width: 70px;
      text-align: center;
    `;
    this.timeElement.textContent = "12:00 PM";

    // Period text (Dawn, Noon, etc.)
    this.periodElement = document.createElement("span");
    this.periodElement.id = "time-period";
    this.periodElement.style.cssText = `
      font-size: 11px;
      font-weight: 500;
      color: #aaaaaa;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
    `;
    this.periodElement.textContent = "NOON";

    // Assemble
    this.container.appendChild(iconElement);
    this.container.appendChild(this.timeElement);
    this.container.appendChild(this.periodElement);
    document.body.appendChild(this.container);

    // Start updating
    this.startUpdating();
  }

  /**
   * Start the update loop
   */
  startUpdating() {
    setInterval(() => {
      this.update();
    }, 1000); // Update every second
  }

  /**
   * Update the display
   */
  update() {
    if (!this.dayNightCycle) return;

    // Update time text
    const timeString = this.dayNightCycle.getTimeString();
    this.timeElement.textContent = timeString;

    // Update period text with color
    const period = this.dayNightCycle.getCurrentPeriod();
    this.periodElement.textContent = period.toUpperCase();

    // Update icon based on time
    const icon = this.getTimeIcon();
    const iconElement = document.getElementById("time-icon");
    if (iconElement) {
      iconElement.textContent = icon;
    }

    // Update period color based on time
    const color = this.getPeriodColor(period);
    this.periodElement.style.background = color;
  }

  /**
   * Get appropriate icon for current time
   */
  getTimeIcon() {
    const time = this.dayNightCycle.currentTime;

    if (time >= 22 || time < 5) return "🌙"; // Moon for night
    if (time >= 5 && time < 7) return "🌅"; // Sunrise
    if (time >= 7 && time < 12) return "🌤️"; // Morning sun
    if (time >= 12 && time < 17) return "☀️"; // Bright sun
    if (time >= 17 && time < 19) return "🌇"; // Sunset
    if (time >= 19 && time < 22) return "🌆"; // Dusk

    return "🕐"; // Default clock
  }

  /**
   * Get color for period badge
   */
  getPeriodColor(period) {
    const colors = {
      Midnight: "rgba(10, 10, 30, 0.6)",
      Night: "rgba(15, 15, 40, 0.6)",
      "Late Night": "rgba(20, 20, 45, 0.6)",
      "Pre-Dawn": "rgba(40, 40, 70, 0.6)",
      "Early Dawn": "rgba(80, 70, 90, 0.6)",
      Dawn: "rgba(255, 107, 74, 0.4)",
      Sunrise: "rgba(255, 170, 119, 0.4)",
      "Early Morning": "rgba(255, 212, 163, 0.4)",
      Morning: "rgba(135, 206, 235, 0.4)",
      "Late Morning": "rgba(91, 155, 213, 0.4)",
      Noon: "rgba(74, 144, 226, 0.5)",
      "Early Afternoon": "rgba(91, 155, 213, 0.4)",
      Afternoon: "rgba(135, 206, 235, 0.4)",
      "Late Afternoon": "rgba(184, 212, 241, 0.4)",
      "Golden Hour": "rgba(255, 201, 102, 0.5)",
      Evening: "rgba(255, 153, 85, 0.4)",
      "Sunset Start": "rgba(255, 119, 68, 0.4)",
      Sunset: "rgba(255, 85, 51, 0.4)",
      "Late Sunset": "rgba(204, 68, 102, 0.4)",
      Dusk: "rgba(102, 68, 136, 0.4)",
      "Late Dusk": "rgba(61, 61, 107, 0.4)",
      "Early Night": "rgba(30, 30, 62, 0.5)",
    };

    return colors[period] || "rgba(255, 255, 255, 0.1)";
  }

  /**
   * Show the display
   */
  show() {
    if (this.container) {
      this.container.style.display = "flex";
    }
  }

  /**
   * Hide the display
   */
  hide() {
    if (this.container) {
      this.container.style.display = "none";
    }
  }

  /**
   * Toggle visibility
   */
  toggle() {
    if (this.container) {
      const isVisible = this.container.style.display !== "none";
      if (isVisible) {
        this.hide();
      } else {
        this.show();
      }
      return !isVisible;
    }
    return false;
  }

  /**
   * Remove the display
   */
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
