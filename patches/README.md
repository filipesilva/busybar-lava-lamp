# patches

Applied by `patch-package` on `npm install`.

- `@busy-app/cli`: the build packs the app with `tar --format ustar`, the only format the bar reads. On macOS the system tar (bsdtar) adds PAX headers and AppleDouble `._*` files for extended attributes. The bar skips the PAX headers with a warning, but installs the `._*` files next to the app's files. Upstream issue: https://github.com/busy-app/busy-tools/issues/18. Remove the patch once a release packs ustar.
