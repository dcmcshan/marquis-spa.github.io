# Marquis SPA - GitHub Pages Site

This is a static site version of Marquis SPA, built with Jekyll for GitHub Pages.

## Features

- **Static Site**: Fast loading, no server-side processing required
- **Responsive Design**: Works on all devices
- **Service Listings**: Display all spa services with pricing
- **Booking Integration**: Embedded scheduling via Calendly/Acuity
- **SEO Optimized**: Built-in SEO tags and structured data

## Services

- Swedish Massage
- Deep Tissue Massage
- Hot Stone Massage
- Aromatherapy Massage
- Facial Treatments
- Body Wraps
- Manicure & Pedicure

## Setup

### Local Development

1. Install Ruby and Bundler
2. Run `bundle install`
3. Run `bundle exec jekyll serve`
4. Visit `http://localhost:4000`

### GitHub Pages Deployment

1. Push this repository to GitHub
2. Go to Settings > Pages
3. Select the `main` branch as the source
4. Your site will be live at `https://<username>.github.io/marquis-spa/`

## Configuration

Edit `_config.yml` to customize:
- Site title and description
- Google Analytics ID
- Base URL for your GitHub Pages

## Booking Integration

Replace the Calendly iframe in `_layouts/home.html` with your preferred booking service:
- Calendly
- Acuity Scheduling
- Google Calendar
- Any other booking platform

## E-commerce Integration

For WooCommerce functionality, integrate with:
- Shopify Buy Button
- Ecwid
- Square Online
- WooCommerce REST API (headless)

## Customization

- Edit `_data/services.yml` to update services
- Edit `_data/features.yml` to update features
- Modify `_sass/minima/_layout.scss` for styling
